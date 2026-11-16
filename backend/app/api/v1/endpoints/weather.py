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


@router.get("")
def get_weather_month(
    month: Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")],
    db: Annotated[Session, Depends(get_db)],
    fetch: Annotated[weather_service.Fetcher | None, Depends(get_weather_fetcher)],
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
        ],
    )
