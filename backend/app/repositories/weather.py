from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import WeatherDaily


def list_between(db: Session, station_id: str, start: date, end: date) -> list[WeatherDaily]:
    """양 끝 포함, 날짜순."""
    return list(
        db.scalars(
            select(WeatherDaily)
            .where(
                WeatherDaily.station_id == station_id,
                WeatherDaily.weather_date >= start,
                WeatherDaily.weather_date <= end,
            )
            .order_by(WeatherDaily.weather_date)
        ).all()
    )


def get(db: Session, station_id: str, day: date) -> WeatherDaily | None:
    return db.get(WeatherDaily, (station_id, day))


def add(db: Session, row: WeatherDaily) -> None:
    db.add(row)
