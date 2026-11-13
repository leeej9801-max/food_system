from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import InventoryAdjustment, InventoryCount, InventoryReceipt


def insert(db: Session, row: InventoryReceipt | InventoryCount | InventoryAdjustment) -> None:
    db.add(row)
    db.flush()


def list_receipts_latest_first(
    db: Session, store_id: UUID, ingredient_id: UUID | None = None
) -> list[InventoryReceipt]:
    stmt = select(InventoryReceipt).where(InventoryReceipt.store_id == store_id)
    if ingredient_id:
        stmt = stmt.where(InventoryReceipt.ingredient_id == ingredient_id)
    stmt = stmt.order_by(InventoryReceipt.received_at.desc(), InventoryReceipt.id.desc())
    return list(db.scalars(stmt).all())


def list_counts_latest_first(
    db: Session, store_id: UUID, ingredient_id: UUID | None = None
) -> list[InventoryCount]:
    stmt = select(InventoryCount).where(InventoryCount.store_id == store_id)
    if ingredient_id:
        stmt = stmt.where(InventoryCount.ingredient_id == ingredient_id)
    stmt = stmt.order_by(InventoryCount.counted_at.desc(), InventoryCount.id.desc())
    return list(db.scalars(stmt).all())


def list_adjustments(db: Session, store_id: UUID) -> list[InventoryAdjustment]:
    return list(
        db.scalars(
            select(InventoryAdjustment).where(InventoryAdjustment.store_id == store_id)
        ).all()
    )


def sum_receipt_cost_between(
    db: Session, store_id: UUID, start: datetime, end: datetime
) -> Decimal:
    total = db.scalar(
        select(func.sum(InventoryReceipt.total_cost)).where(
            InventoryReceipt.store_id == store_id,
            InventoryReceipt.received_at >= start,
            InventoryReceipt.received_at < end,
        )
    )
    return total or Decimal(0)
