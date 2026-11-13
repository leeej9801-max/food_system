from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import HolidayCreate, HolidayResponse
from app.services import holidays as holiday_service

router = APIRouter(prefix="/holidays", tags=["holidays"])


@router.get("")
def get_holidays(
    year: Annotated[int, Query(ge=2000, le=2100)],
    db: Annotated[Session, Depends(get_db)],
) -> list[HolidayResponse]:
    return holiday_service.list_holidays(db, year)


@router.post("", status_code=status.HTTP_201_CREATED)
def post_holiday(
    payload: HolidayCreate, db: Annotated[Session, Depends(get_db)]
) -> HolidayResponse:
    return holiday_service.add_manual_holiday(db, payload)
