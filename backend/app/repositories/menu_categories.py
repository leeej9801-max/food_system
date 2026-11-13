from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import MenuCategory


def list_by_store(db: Session, store_id: UUID) -> list[MenuCategory]:
    """만든 순서대로."""
    return list(
        db.scalars(
            select(MenuCategory)
            .where(MenuCategory.store_id == store_id)
            .order_by(MenuCategory.created_at.asc(), MenuCategory.name.asc())
        ).all()
    )


def find_by_name(db: Session, store_id: UUID, name: str) -> MenuCategory | None:
    return db.scalars(
        select(MenuCategory).where(MenuCategory.store_id == store_id, MenuCategory.name == name)
    ).first()


def insert(db: Session, category: MenuCategory) -> None:
    db.add(category)
    db.flush()
