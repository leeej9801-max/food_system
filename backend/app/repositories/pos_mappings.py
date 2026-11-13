from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import PosProductMapping


def list_menu_ids(db: Session, store_id: UUID) -> list[UUID]:
    return list(
        db.scalars(
            select(PosProductMapping.menu_item_id).where(PosProductMapping.store_id == store_id)
        ).all()
    )


def list_by_store(db: Session, store_id: UUID) -> list[PosProductMapping]:
    return list(
        db.scalars(select(PosProductMapping).where(PosProductMapping.store_id == store_id)).all()
    )


def list_by_store_ordered(db: Session, store_id: UUID) -> list[PosProductMapping]:
    """외부 상품명순."""
    return list(
        db.scalars(
            select(PosProductMapping)
            .where(PosProductMapping.store_id == store_id)
            .order_by(PosProductMapping.external_product_name.asc())
        ).all()
    )


def insert(db: Session, mapping: PosProductMapping) -> None:
    db.add(mapping)
    db.flush()
