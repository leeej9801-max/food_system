from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from app.db.models import utcnow
from app.db.session import get_db
from app.schemas import (
    PNL_MONTH_PATTERN,
    PnlDayDetail,
    PnlExpensesUpdate,
    PnlGoalUpdate,
    PnlResponse,
)
from app.services import pnl as pnl_service

router = APIRouter(prefix="/stores/{store_id}/pnl", tags=["pnl"])

Month = Annotated[str, Query(pattern=PNL_MONTH_PATTERN, description="YYYY-MM, 매장 시간대 기준")]
Now = Annotated[datetime, Depends(utcnow)]


@router.get("")
def get_pnl(
    store_id: UUID,
    month: Month,
    db: Annotated[Session, Depends(get_db)],
    now: Now,
    average_months: Annotated[int, Query(ge=1, le=6)] = 3,
) -> PnlResponse:
    return pnl_service.get_pnl(
        db, store_id=store_id, month=month, now=now, average_months=average_months
    )


@router.get("/days/{day}")
def get_pnl_day(store_id: UUID, day: date, db: Annotated[Session, Depends(get_db)]) -> PnlDayDetail:
    if not 2000 <= day.year <= 2099:
        raise HTTPException(status_code=422, detail="day must be between 2000 and 2099")
    return pnl_service.get_day_detail(db, store_id=store_id, day=day)


@router.put("/{month}/expenses")
def put_pnl_expenses(
    store_id: UUID,
    month: Annotated[str, Path(pattern=PNL_MONTH_PATTERN)],
    payload: PnlExpensesUpdate,
    db: Annotated[Session, Depends(get_db)],
    now: Now,
) -> PnlResponse:
    return pnl_service.save_expenses(db, store_id=store_id, month=month, payload=payload, now=now)


@router.put("/{month}/goal")
def put_pnl_goal(
    store_id: UUID,
    month: Annotated[str, Path(pattern=PNL_MONTH_PATTERN)],
    payload: PnlGoalUpdate,
    db: Annotated[Session, Depends(get_db)],
    now: Now,
) -> PnlResponse:
    return pnl_service.save_goal(db, store_id=store_id, month=month, payload=payload, now=now)
