from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Holiday


def list_between(db: Session, start: date, end: date) -> list[Holiday]:
    """양 끝 포함, 날짜순."""
    return list(
        db.scalars(
            select(Holiday)
            .where(Holiday.holiday_date >= start, Holiday.holiday_date <= end)
            .order_by(Holiday.holiday_date)
        ).all()
    )


def get(db: Session, day: date) -> Holiday | None:
    return db.get(Holiday, day)


def add(db: Session, row: Holiday) -> None:
    db.add(row)
