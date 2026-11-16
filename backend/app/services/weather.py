"""전역 일별 날씨 (U-28, U-56). 기상청 API허브 AWS 매분자료를 하루치로 모아 넣는다.

지난 날은 한 번 받아 weather_daily에 두고, 오늘은 짧게 캐시해서 다시 받는다.
"""

import logging
import time
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import WeatherDaily
from app.repositories import weather as weather_repo

logger = logging.getLogger(__name__)

AWS_URL = "https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-aws2_min"
SOURCE = "KMA_AWS"
# disp=1 열 순서: YYMMDDHHMI,STN,WD1,WS1,WDS,WSS,WD10,WS10,TA,RE,RN-15m,RN-60m,RN-12H,RN-DAY,...
TA, RN_DAY = 8, 13
FETCH_WORKERS = 8  # 하루 1회 호출이 4~5초라 한 달을 나눠 받는다
TODAY_TTL_SECONDS = 3600


@dataclass(frozen=True)
class DailyWeather:
    weather_date: date
    avg_temp: Decimal | None
    min_temp: Decimal | None
    max_temp: Decimal | None
    precipitation_mm: Decimal | None


FIELDS = ("avg_temp", "min_temp", "max_temp", "precipitation_mm")
Fetcher = Callable[[date], DailyWeather | None]


def _one_decimal(value: float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def parse_aws_minutes(text: str, day: date) -> DailyWeather | None:
    """매분자료 → 하루 값. 결측(-99.x)은 버린다. 그날 자료가 하나도 없으면 None."""
    prefix = day.strftime("%Y%m%d")
    temps: list[float] = []
    rain: float | None = None
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        cols = line.rstrip(",=").split(",")
        if len(cols) <= RN_DAY or not cols[0].startswith(prefix):
            continue
        try:
            ta, rn = float(cols[TA]), float(cols[RN_DAY])
        except ValueError:
            continue
        if ta > -90:
            temps.append(ta)
        # 00:00 행의 일강수는 전날 누적값이라 뺀다
        if cols[0][8:] != "0000" and rn >= 0:
            rain = rn if rain is None else max(rain, rn)
    if not temps and rain is None:
        return None
    return DailyWeather(
        weather_date=day,
        avg_temp=_one_decimal(sum(temps) / len(temps)) if temps else None,
        min_temp=_one_decimal(min(temps)) if temps else None,
        max_temp=_one_decimal(max(temps)) if temps else None,
        precipitation_mm=_one_decimal(rain) if rain is not None else None,
    )


def fetch_aws_day(day: date, station_id: str, auth_key: str) -> DailyWeather | None:
    """API허브는 한 번에 최근 1440분만 주므로 하루씩 부른다. 키는 로그에 남기지 않는다."""
    d = day.strftime("%Y%m%d")
    url = f"{AWS_URL}?tm1={d}0000&tm2={d}2359&stn={station_id}&disp=1&help=0&authKey={auth_key}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return parse_aws_minutes(resp.read().decode("euc-kr", "replace"), day)


def sky_of(
    precipitation_mm: Decimal | None, max_temp: Decimal | None
) -> Literal["RAIN", "SNOW", "DRY"] | None:
    """강수만으로 정한다(구름 자료 없음). 눈은 최고기온 1도 이하로 추정한다(PROVISIONAL)."""
    if precipitation_mm is None:
        return None
    if precipitation_mm > 0:
        return "SNOW" if max_temp is not None and max_temp <= 1 else "RAIN"
    return "DRY"


def upsert_weather(
    db: Session, station_id: str, items: list[DailyWeather], source: str = SOURCE
) -> int:
    """같은 관측소·날짜가 있으면 값을 고친다. 넣거나 고친 수를 돌려준다."""
    changed = 0
    for item in items:
        row = weather_repo.get(db, station_id, item.weather_date)
        if row is None:
            row = WeatherDaily(station_id=station_id, weather_date=item.weather_date)
            weather_repo.add(db, row)
        elif row.source == source and all(getattr(row, f) == getattr(item, f) for f in FIELDS):
            continue
        for f in FIELDS:
            setattr(row, f, getattr(item, f))
        row.source = source
        changed += 1
    db.commit()
    return changed


def _safe(fetch: Fetcher, day: date) -> DailyWeather | None:
    try:
        return fetch(day)
    except OSError as exc:  # 네트워크·시간초과: 그날은 다음 조회 때 다시 받는다
        logger.warning("weather fetch failed %s: %s", day, type(exc).__name__)
        return None


# shortcut: 프로세스 메모리 캐시라 워커마다 따로 받는다. 워커가 늘면 DB에 받은 시각을 둔다
_today_cache: dict[tuple[str, date], tuple[float, DailyWeather | None]] = {}


def month_weather(
    db: Session,
    station_id: str,
    start: date,
    end: date,
    today: date,
    fetch: Fetcher | None,
) -> list[DailyWeather]:
    """start~end 날씨. 빠진 지난 날은 받아서 저장하고, 오늘은 1시간 캐시로 붙인다."""
    stored = {r.weather_date: r for r in weather_repo.list_between(db, station_id, start, end)}
    last_past = min(end, today - timedelta(days=1))
    missing = [
        start + timedelta(days=i)
        for i in range((last_past - start).days + 1)
        if start + timedelta(days=i) not in stored
    ]
    if fetch and missing:
        with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
            got = [w for w in pool.map(lambda d: _safe(fetch, d), missing) if w]
        if got:
            try:
                upsert_weather(db, station_id, got)
            except IntegrityError:  # 같은 달을 동시에 연 다른 요청이 먼저 넣었다
                db.rollback()
            stored = {
                r.weather_date: r for r in weather_repo.list_between(db, station_id, start, end)
            }
    days = [
        DailyWeather(r.weather_date, r.avg_temp, r.min_temp, r.max_temp, r.precipitation_mm)
        for r in stored.values()
        if r.weather_date < today or not fetch
    ]
    if fetch and start <= today <= end:
        key = (station_id, today)
        cached = _today_cache.get(key)
        if cached is None or time.monotonic() - cached[0] > TODAY_TTL_SECONDS:
            cached = (time.monotonic(), _safe(fetch, today))
            _today_cache[key] = cached
        if cached[1]:
            days.append(cached[1])
    return sorted(days, key=lambda w: w.weather_date)
