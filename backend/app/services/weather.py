"""전역 일별 날씨 (U-28, U-56). 기상청 API허브 AWS 매분자료를 하루치로 모아 넣는다.

지난 날은 한 번 받아 weather_daily에 두고, 오늘은 짧게 캐시해서 다시 받는다.
"""

import json
import logging
import time
import urllib.request
from collections import Counter
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta
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


SkyType = Literal["RAIN", "SNOW", "DRY", "CLEAR", "CLOUDY", "OVERCAST"]


def sky_of(precipitation_mm: Decimal | None, max_temp: Decimal | None) -> SkyType | None:
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


# ---- 단기예보 (오늘 기준 +5일, U-57) ----
FCST_URL = "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst"
FCST_BASE_HOURS = (2, 5, 8, 11, 14, 17, 20, 23)
FCST_DAYS = 5
# 단기예보 SKY 코드: 1 맑음, 3 구름많음, 4 흐림. PTY 3 눈, 7 눈날림(나머지 0 아닌 값은 비·빗방울)
SKY_CODES: dict[str, SkyType] = {"1": "CLEAR", "3": "CLOUDY", "4": "OVERCAST"}
SNOW_PTY = {"3", "7"}


@dataclass(frozen=True)
class DayForecast:
    weather_date: date
    min_temp: Decimal | None
    max_temp: Decimal | None
    precipitation_chance: int | None
    sky: SkyType | None


ForecastFetcher = Callable[[], list[DayForecast]]


def forecast_base(now: datetime) -> datetime:
    """가장 최근 발표 시각. 발표 뒤 10분부터 받을 수 있어 15분 여유를 둔다."""
    t = now - timedelta(minutes=15)
    hours = [h for h in FCST_BASE_HOURS if h <= t.hour]
    if not hours:
        return (t - timedelta(days=1)).replace(hour=23, minute=0, second=0, microsecond=0)
    return t.replace(hour=hours[-1], minute=0, second=0, microsecond=0)


def summarize_forecast(items: list[dict]) -> list[DayForecast]:
    """시간별 예보를 날짜별로 줄인다. 하늘·강수는 영업 시간대(06~21시)만 본다."""
    by_day: dict[str, list[dict]] = {}
    for it in items:
        by_day.setdefault(it["fcstDate"], []).append(it)
    out = []
    for d, rows in sorted(by_day.items()):
        values: dict[str, list[str]] = {}
        for r in rows:
            if r["category"] in ("TMN", "TMX") or "0600" <= r["fcstTime"] <= "2100":
                values.setdefault(r["category"], []).append(str(r["fcstValue"]))
        wet = [v for v in values.get("PTY", []) if v != "0"]
        skies = [SKY_CODES[v] for v in values.get("SKY", []) if v in SKY_CODES]
        if wet:
            sky: SkyType | None = "SNOW" if all(v in SNOW_PTY for v in wet) else "RAIN"
        elif skies:
            # 가장 많이 나온 하늘. 같으면 더 흐린 쪽
            order: tuple[SkyType, ...] = ("CLEAR", "CLOUDY", "OVERCAST")
            counts = Counter(skies)
            sky = max(order, key=lambda k: (counts[k], order.index(k)))
        else:
            sky = None
        out.append(
            DayForecast(
                weather_date=date(int(d[:4]), int(d[4:6]), int(d[6:])),
                min_temp=_one_decimal(float(values["TMN"][0])) if values.get("TMN") else None,
                max_temp=_one_decimal(float(values["TMX"][0])) if values.get("TMX") else None,
                precipitation_chance=max(map(int, values["POP"])) if values.get("POP") else None,
                sky=sky,
            )
        )
    return out


def fetch_forecast(now: datetime, nx: int, ny: int, auth_key: str) -> list[DayForecast]:
    base = forecast_base(now)
    url = (
        f"{FCST_URL}?pageNo=1&numOfRows=2000&dataType=JSON&base_date={base:%Y%m%d}"
        f"&base_time={base:%H}00&nx={nx}&ny={ny}&authKey={auth_key}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    body = payload["response"]
    if body["header"]["resultCode"] != "00":
        raise OSError(f"forecast result {body['header']['resultCode']}")
    return summarize_forecast(body["body"]["items"]["item"])


# shortcut: 프로세스 메모리 캐시. 예보 발표가 3시간 간격이라 1시간이면 충분하다
_forecast_cache: dict[str, tuple[float, list[DayForecast]]] = {}


def upcoming_forecast(today: date, fetch: ForecastFetcher | None) -> list[DayForecast]:
    """오늘 다음 날부터 5일 예보. 실패하면 빈 목록(확정 날씨만 보인다)."""
    if fetch is None:
        return []
    cached = _forecast_cache.get("fcst")
    if cached is None or time.monotonic() - cached[0] > TODAY_TTL_SECONDS:
        try:
            cached = (time.monotonic(), fetch())
        except (OSError, KeyError, ValueError) as exc:
            logger.warning("forecast fetch failed: %s", type(exc).__name__)
            return []
        _forecast_cache["fcst"] = cached
    last = today + timedelta(days=FCST_DAYS)
    return [f for f in cached[1] if today < f.weather_date <= last]
