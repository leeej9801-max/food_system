import calendar
from datetime import date, datetime
from functools import partial
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.schemas import WeatherMonthDay, WeatherMonthResponse
from app.services import weather as weather_service

router = APIRouter(prefix="/weather", tags=["weather"])


def get_weather_fetcher() -> weather_service.Fetcher | None:
    """키나 지점이 없으면 저장된 값만 쓴다. 테스트는 dependency_overrides로 바꾼다."""
    if not settings.kma_apihub_key or not settings.kma_station_id:
        return None
    return partial(
        weather_service.fetch_aws_day,
        station_id=settings.kma_station_id,
        auth_key=settings.kma_apihub_key,
    )


def get_forecast_fetcher() -> weather_service.ForecastFetcher | None:
    if not settings.kma_apihub_key or not settings.kma_grid_nx or not settings.kma_grid_ny:
        return None
    tz = ZoneInfo(settings.app_timezone)
    return lambda: weather_service.fetch_forecast(
        datetime.now(tz), settings.kma_grid_nx, settings.kma_grid_ny, settings.kma_apihub_key
    )


@router.get("")
def get_weather_month(
    month: Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")],
    db: Annotated[Session, Depends(get_db)],
    fetch: Annotated[weather_service.Fetcher | None, Depends(get_weather_fetcher)],
    fetch_forecast: Annotated[
        weather_service.ForecastFetcher | None, Depends(get_forecast_fetcher)
    ],
) -> WeatherMonthResponse:
    """그 달의 일별 날씨. 처음 여는 달은 기상청에서 받느라 수십 초 걸릴 수 있다."""
    station = settings.kma_station_id
    if not station:
        return WeatherMonthResponse(station_id=None, source=None, days=[])
    year, mon = map(int, month.split("-"))
    start = date(year, mon, 1)
    end = date(year, mon, calendar.monthrange(year, mon)[1])
    today = datetime.now(ZoneInfo(settings.app_timezone)).date()
    days = weather_service.month_weather(db, station, start, end, today, fetch)
    forecast = [
        f
        for f in weather_service.upcoming_forecast(today, fetch_forecast)
        if start <= f.weather_date <= end
    ]
    return WeatherMonthResponse(
        station_id=station,
        source=weather_service.SOURCE,
        days=[
            WeatherMonthDay(
                date=w.weather_date,
                avg_temp=w.avg_temp,
                min_temp=w.min_temp,
                max_temp=w.max_temp,
                precipitation_mm=w.precipitation_mm,
                sky=weather_service.sky_of(w.precipitation_mm, w.max_temp),
            )
            for w in days
        ]
        + [
            WeatherMonthDay(
                date=f.weather_date,
                avg_temp=None,
                min_temp=f.min_temp,
                max_temp=f.max_temp,
                precipitation_mm=None,
                sky=f.sky,
                forecast=True,
                precipitation_chance=f.precipitation_chance,
            )
            for f in forecast
        ],
    )
