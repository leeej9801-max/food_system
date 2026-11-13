from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import PosConnection


def find_by_store(db: Session, store_id: UUID) -> PosConnection | None:
    return db.scalars(select(PosConnection).where(PosConnection.store_id == store_id)).first()


def insert(db: Session, conn: PosConnection) -> None:
    db.add(conn)
    db.flush()
