from uuid import UUID

from sqlalchemy import select
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
