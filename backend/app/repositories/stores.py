from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Store, StoreTable


def list_all(db: Session) -> list[Store]:
    """만든 순서대로."""
    return list(db.scalars(select(Store).order_by(Store.created_at.asc())).all())


def get(db: Session, store_id: UUID) -> Store | None:
    return db.get(Store, store_id)


def insert(db: Session, store: Store) -> None:
    db.add(store)
    db.flush()


def add_table(db: Session, table: StoreTable) -> None:
    db.add(table)
