from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import HolidayCreate, HolidayResponse
from app.services import holidays as holiday_service

router = APIRouter(prefix="/holidays", tags=["holidays"])


@router.get("", response_model=list[HolidayResponse])
def get_holidays(
    year: int = Query(..., ge=2000, le=2100),
    db: Session = Depends(get_db),
) -> list[HolidayResponse]:
    return holiday_service.list_holidays(db, year)


@router.post("", response_model=HolidayResponse, status_code=status.HTTP_201_CREATED)
def post_holiday(payload: HolidayCreate, db: Session = Depends(get_db)) -> HolidayResponse:
    return holiday_service.add_manual_holiday(db, payload)
