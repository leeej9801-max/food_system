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


@router.get("/summary", response_model=list[IngredientInventoryItem])
def get_inventory_summary_endpoint(
    store_id: str,
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[IngredientInventoryItem]:
    return inventory_service.get_inventory_summary(
        db, store_id=store_id, include_inactive=include_inactive
    )


@router.get("/receipts", response_model=list[InventoryReceiptResponse])
def list_receipts_endpoint(
    store_id: str,
    ingredient_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[InventoryReceiptResponse]:
    return inventory_service.list_receipts(
        db, store_id=store_id, ingredient_id=ingredient_id
    )


@router.post(
    "/receipts",
    response_model=InventoryReceiptResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_receipt_endpoint(
    store_id: str,
    payload: InventoryReceiptCreate,
    db: Session = Depends(get_db),
) -> InventoryReceiptResponse:
    return inventory_service.create_receipt(db, store_id=store_id, payload=payload)


@router.get("/counts", response_model=list[InventoryCountResponse])
def list_counts_endpoint(
    store_id: str,
    ingredient_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[InventoryCountResponse]:
    return inventory_service.list_counts(
        db, store_id=store_id, ingredient_id=ingredient_id
    )


@router.post(
    "/counts",
    response_model=InventoryCountResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_count_endpoint(
    store_id: str,
    payload: InventoryCountCreate,
    db: Session = Depends(get_db),
) -> InventoryCountResponse:
    return inventory_service.create_count(db, store_id=store_id, payload=payload)


@router.post(
    "/adjustments",
    response_model=InventoryAdjustmentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_adjustment_endpoint(
    store_id: str,
    payload: InventoryAdjustmentCreate,
    db: Session = Depends(get_db),
) -> InventoryAdjustmentResponse:
    return inventory_service.create_adjustment(db, store_id=store_id, payload=payload)
