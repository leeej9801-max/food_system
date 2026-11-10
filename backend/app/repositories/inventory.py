from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import InventoryReceipt


def list_receipts_latest_first(db: Session, store_id: str) -> list[InventoryReceipt]:
    return list(
        db.scalars(
            select(InventoryReceipt)
            .where(InventoryReceipt.store_id == store_id)
            .order_by(InventoryReceipt.received_at.desc(), InventoryReceipt.id.desc())
        ).all()
    )
