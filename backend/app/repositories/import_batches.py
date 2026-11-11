from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ImportBatch


def find_committed_by_hash(db: Session, store_id: UUID, file_hash: str) -> ImportBatch | None:
    return db.scalars(
        select(ImportBatch).where(
            ImportBatch.store_id == store_id,
            ImportBatch.file_hash == file_hash,
            ImportBatch.status == "COMMITTED",
        )
    ).first()


def find(db: Session, store_id: UUID, batch_id: UUID) -> ImportBatch | None:
    return db.scalars(
        select(ImportBatch).where(ImportBatch.id == batch_id, ImportBatch.store_id == store_id)
    ).first()


def add(db: Session, batch: ImportBatch) -> None:
    db.add(batch)
