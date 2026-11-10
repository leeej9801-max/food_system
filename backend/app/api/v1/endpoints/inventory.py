from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import (
    IngredientInventoryItem,
    InventoryAdjustmentCreate,
    InventoryAdjustmentResponse,
    InventoryCountCreate,
    InventoryCountResponse,
    InventoryReceiptCreate,
    InventoryReceiptResponse,
)
from app.services import inventory as inventory_service

router = APIRouter(prefix="/stores/{store_id}/inventory", tags=["inventory"])


@router.get("/summary")
def get_inventory_summary_endpoint(
    store_id: str,
    db: Annotated[Session, Depends(get_db)],
    include_inactive: Annotated[bool, Query()] = False,
) -> list[IngredientInventoryItem]:
    return inventory_service.get_inventory_summary(
        db, store_id=store_id, include_inactive=include_inactive
    )


@router.get("/receipts")
def list_receipts_endpoint(
    store_id: str,
    db: Annotated[Session, Depends(get_db)],
    ingredient_id: Annotated[str | None, Query()] = None,
) -> list[InventoryReceiptResponse]:
    return inventory_service.list_receipts(db, store_id=store_id, ingredient_id=ingredient_id)


@router.post(
    "/receipts",
    status_code=status.HTTP_201_CREATED,
)
def create_receipt_endpoint(
    store_id: str,
    payload: InventoryReceiptCreate,
    db: Annotated[Session, Depends(get_db)],
) -> InventoryReceiptResponse:
    return inventory_service.create_receipt(db, store_id=store_id, payload=payload)


@router.get("/counts")
def list_counts_endpoint(
    store_id: str,
    db: Annotated[Session, Depends(get_db)],
    ingredient_id: Annotated[str | None, Query()] = None,
) -> list[InventoryCountResponse]:
    return inventory_service.list_counts(db, store_id=store_id, ingredient_id=ingredient_id)


@router.post(
    "/counts",
    status_code=status.HTTP_201_CREATED,
)
def create_count_endpoint(
    store_id: str,
    payload: InventoryCountCreate,
    db: Annotated[Session, Depends(get_db)],
) -> InventoryCountResponse:
    return inventory_service.create_count(db, store_id=store_id, payload=payload)


@router.post(
    "/adjustments",
    status_code=status.HTTP_201_CREATED,
)
def create_adjustment_endpoint(
    store_id: str,
    payload: InventoryAdjustmentCreate,
    db: Annotated[Session, Depends(get_db)],
) -> InventoryAdjustmentResponse:
    return inventory_service.create_adjustment(db, store_id=store_id, payload=payload)
