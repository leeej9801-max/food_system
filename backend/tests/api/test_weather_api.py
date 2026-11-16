"""손익 캘린더 날씨 (U-56). 기상청 호출은 dependency_overrides로 바꾼다."""

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.endpoints.weather import get_forecast_fetcher, get_weather_fetcher
from app.core.config import settings
from app.db.models import WeatherDaily
from app.services import weather as weather_service
from app.services.weather import (
    DailyWeather,
    DayForecast,
    forecast_base,
    parse_aws_minutes,
    sky_of,
    summarize_forecast,
)

STATION = "999"


def _row(day: str, hhmi: str, ta: str, rn_day: str) -> str:
    # YYMMDDHHMI,STN,WD1,WS1,WDS,WSS,WD10,WS10,TA,RE,RN-15m,RN-60m,RN-12H,RN-DAY,HM,PA,PS,TD,=
    return f"{day}{hhmi},433,1,1,1,1,1,1,{ta},0,0,0,0,{rn_day},50,1000,1010,1,="


def test_parse_aws_minutes() -> None:
    text = "\n".join(
        [
            "# YYMMDDHHMI STN ...",
            _row("20261110", "0000", "4.0", "8.0"),  # 일강수는 전날 누적이라 버린다
            _row("20261110", "0600", "2.0", "0.0"),
            _row("20261110", "1200", "-99.9", "-99.9"),  # 결측
            _row("20261110", "2359", "9.05", "3.5"),
            _row("20261111", "0001", "30.0", "50.0"),  # 다른 날
            "#7777END",
        ]
    )
    w = parse_aws_minutes(text, date(2026, 11, 10))
    assert w == DailyWeather(
        date(2026, 11, 10), Decimal("5.0"), Decimal("2.0"), Decimal("9.1"), Decimal("3.5")
    )
    assert parse_aws_minutes(_row("20261110", "0100", "-99.9", "-99.9"), date(2026, 11, 10)) is None


def test_sky_of() -> None:
    assert sky_of(None, Decimal("10")) is None
    assert sky_of(Decimal("0"), Decimal("10")) == "DRY"
    assert sky_of(Decimal("2.5"), Decimal("10")) == "RAIN"
    assert sky_of(Decimal("2.5"), Decimal("1.0")) == "SNOW"


def test_weather_month_fills_missing_past_days(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "kma_station_id", STATION)
    weather_service._today_cache.clear()
    db_session.add(
        WeatherDaily(
            station_id=STATION,
            weather_date=date(2026, 10, 1),
            avg_temp=Decimal("15.0"),
            min_temp=Decimal("10.0"),
            max_temp=Decimal("20.0"),
            precipitation_mm=Decimal("0"),
        )
    )
    db_session.commit()
    calls: list[date] = []

    def fake(day: date) -> DailyWeather | None:
        calls.append(day)
        if day.day == 3:
            raise TimeoutError  # 실패한 날은 비워 두고 다음에 다시 받는다
        rain = Decimal("4.0") if day.day == 2 else Decimal("0")
        return DailyWeather(day, Decimal("12.0"), Decimal("8.0"), Decimal("16.0"), rain)

    client.app.dependency_overrides[get_weather_fetcher] = lambda: fake  # type: ignore[attr-defined]
    data = client.get("/api/v1/weather", params={"month": "2026-10"}).json()
    assert data["station_id"] == STATION and data["source"] == "KMA_AWS"
    assert len(calls) == 30  # 10/1은 저장돼 있어 다시 받지 않는다
    days = {d["date"]: d for d in data["days"]}
    assert len(days) == 30 and "2026-10-03" not in days
    assert days["2026-10-01"]["max_temp"] == "20.0" and days["2026-10-01"]["sky"] == "DRY"
    assert days["2026-10-02"]["sky"] == "RAIN" and days["2026-10-02"]["precipitation_mm"] == "4.0"

    calls.clear()
    client.get("/api/v1/weather", params={"month": "2026-10"})
    assert calls == [date(2026, 10, 3)]  # 저장된 날은 다시 부르지 않는다


def test_weather_month_today_is_live_and_future_empty(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "kma_station_id", STATION)
    weather_service._today_cache.clear()
    today = datetime.now(ZoneInfo(settings.app_timezone)).date()
    calls: list[date] = []

    def fake(day: date) -> DailyWeather | None:
        calls.append(day)
        return DailyWeather(day, None, None, None, Decimal("0"))

    client.app.dependency_overrides[get_weather_fetcher] = lambda: fake  # type: ignore[attr-defined]
    month = today.strftime("%Y-%m")
    first = client.get("/api/v1/weather", params={"month": month}).json()
    assert first["days"][-1]["date"] == today.isoformat()
    assert all(d["date"] <= today.isoformat() for d in first["days"])
    calls.clear()
    client.get("/api/v1/weather", params={"month": month})
    assert calls == []  # 오늘은 1시간 캐시, 지난 날은 저장됨
    future = client.get("/api/v1/weather", params={"month": f"{today.year + 1}-01"}).json()
    assert future["days"] == []


def test_weather_month_without_station(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "kma_station_id", "")
    data = client.get("/api/v1/weather", params={"month": "2026-10"}).json()
    assert data == {"station_id": None, "source": None, "days": []}
    assert client.get("/api/v1/weather", params={"month": "2026-13"}).status_code == 422


def _fc(d: str, t: str, cat: str, v: str) -> dict[str, str]:
    return {"fcstDate": d, "fcstTime": t, "category": cat, "fcstValue": v}


def test_summarize_forecast_and_base() -> None:
    items = [
        _fc("20261117", "0600", "TMN", "3.0"),
        _fc("20261117", "1500", "TMX", "12.0"),
        _fc("20261117", "0900", "SKY", "3"),
        _fc("20261117", "1200", "SKY", "4"),
        _fc("20261117", "1500", "SKY", "4"),
        _fc("20261117", "0300", "PTY", "1"),  # 영업 시간 밖 비는 보지 않는다
        _fc("20261117", "1200", "POP", "30"),
        _fc("20261118", "1200", "PTY", "3"),
        _fc("20261118", "1500", "PTY", "1"),
        _fc("20261119", "1200", "PTY", "3"),
        _fc("20261120", "1200", "SKY", "1"),
        _fc("20261120", "1500", "SKY", "3"),
    ]
    got = {f.weather_date.day: f for f in summarize_forecast(items)}
    assert got[17].sky == "OVERCAST" and got[17].min_temp == Decimal("3.0")
    assert got[17].max_temp == Decimal("12.0") and got[17].precipitation_chance == 30
    assert got[18].sky == "RAIN" and got[19].sky == "SNOW"
    assert got[20].sky == "CLOUDY"  # 같은 횟수면 더 흐린 쪽
    tz = ZoneInfo("Asia/Seoul")
    assert forecast_base(datetime(2026, 11, 16, 20, 10, tzinfo=tz)).hour == 17
    assert forecast_base(datetime(2026, 11, 16, 1, 0, tzinfo=tz)).day == 15


def test_weather_month_adds_forecast_after_today(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "kma_station_id", STATION)
    weather_service._forecast_cache.clear()
    today = datetime.now(ZoneInfo(settings.app_timezone)).date()
    fc = [
        DayForecast(today + timedelta(days=i), Decimal("1.0"), Decimal("9.0"), 20, "CLEAR")
        for i in range(0, 8)
    ]
    overrides = client.app.dependency_overrides  # type: ignore[attr-defined]
    overrides[get_weather_fetcher] = lambda: None
    overrides[get_forecast_fetcher] = lambda: lambda: fc
    months = {today.strftime("%Y-%m"), (today + timedelta(days=5)).strftime("%Y-%m")}
    days = [
        d
        for m in sorted(months)
        for d in client.get("/api/v1/weather", params={"month": m}).json()["days"]
        if d["forecast"]
    ]
    dates = [d["date"] for d in days]
    assert dates == [(today + timedelta(days=i)).isoformat() for i in range(1, 6)]
    assert days[0]["sky"] == "CLEAR" and days[0]["precipitation_chance"] == 20
