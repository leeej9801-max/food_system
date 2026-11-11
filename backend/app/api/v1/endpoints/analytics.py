from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import (
    CostSimulationRequest,
    CostSimulationResponse,
    SalesAnalyticsResponse,
)
from app.services import analytics as analytics_service

router = APIRouter(prefix="/stores/{store_id}/analytics", tags=["analytics"])


@router.get("/sales")
def get_sales_analytics_endpoint(
    store_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> SalesAnalyticsResponse:
    return analytics_service.get_sales_analytics(db, store_id=store_id)


@router.post(
    "/costing",
    status_code=status.HTTP_200_OK,
)
def simulate_menu_costs_endpoint(
    store_id: UUID,
    payload: CostSimulationRequest,
    db: Annotated[Session, Depends(get_db)],
) -> CostSimulationResponse:
    return analytics_service.simulate_menu_costs(db, store_id=store_id, payload=payload)
