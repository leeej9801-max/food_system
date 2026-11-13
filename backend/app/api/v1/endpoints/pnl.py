from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import PNL_MONTH_PATTERN, PnlExpensesUpdate, PnlResponse
from app.services import pnl as pnl_service

router = APIRouter(prefix="/stores/{store_id}/pnl", tags=["pnl"])

Month = Annotated[str, Query(pattern=PNL_MONTH_PATTERN, description="YYYY-MM, 매장 시간대 기준")]


@router.get("")
def get_pnl(store_id: UUID, month: Month, db: Annotated[Session, Depends(get_db)]) -> PnlResponse:
    return pnl_service.get_pnl(db, store_id=store_id, month=month)


@router.put("/{month}/expenses")
def put_pnl_expenses(
    store_id: UUID,
    month: Annotated[str, Path(pattern=PNL_MONTH_PATTERN)],
    payload: PnlExpensesUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> PnlResponse:
    return pnl_service.save_expenses(db, store_id=store_id, month=month, payload=payload)
