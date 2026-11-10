"""전역 공휴일 달력과 날짜 구분 (WO-20261105-001, U-28).

천문연 특일정보(KASI)를 연 1회 수집하고, 임시공휴일은 다시 수집하거나 수동으로 더한다.
"""

from datetime import date
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Holiday
from app.schemas import HolidayCreate, HolidayResponse

DayType = Literal["WEEKDAY", "WEEKEND", "HOLIDAY"]


def list_holidays(db: Session, year: int) -> list[HolidayResponse]:
    rows = db.scalars(
        select(Holiday)
        .where(Holiday.holiday_date >= date(year, 1, 1), Holiday.holiday_date <= date(year, 12, 31))
        .order_by(Holiday.holiday_date)
    ).all()
    return [HolidayResponse.model_validate(r) for r in rows]


def add_manual_holiday(db: Session, payload: HolidayCreate) -> HolidayResponse:
    if db.get(Holiday, payload.holiday_date) is not None:
        raise AppError(status_code=409, code="HOLIDAY_EXISTS", message="이미 등록된 공휴일입니다.")
    row = Holiday(holiday_date=payload.holiday_date, name=payload.name.strip(), source="MANUAL")
    db.add(row)
    db.commit()
    return HolidayResponse.model_validate(row)


def upsert_holidays(db: Session, items: list[tuple[date, str]], source: str = "KASI") -> int:
    """수집 결과를 넣는다. 같은 날짜가 있으면 이름만 고친다. 넣거나 고친 수를 돌려준다."""
    changed = 0
    for day, name in items:
        row = db.get(Holiday, day)
        if row is None:
            db.add(Holiday(holiday_date=day, name=name, source=source))
            changed += 1
        elif row.name != name:
            row.name = name
            changed += 1
    db.commit()
    return changed


def day_type(db: Session, day: date) -> DayType:
    if db.get(Holiday, day) is not None:
        return "HOLIDAY"
    return "WEEKEND" if day.weekday() >= 5 else "WEEKDAY"
