from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import StoreTable, VisitSession


def list_with_visits(
    db: Session, store_id: UUID, *, include_inactive: bool = False
) -> list[StoreTable]:
    """방문·자리까지 불러온다. 격자 위치 순."""
    stmt = (
        select(StoreTable)
        .options(selectinload(StoreTable.visit_sessions).selectinload(VisitSession.slots))
        .where(StoreTable.store_id == store_id)
        .execution_options(populate_existing=True)
    )
    if not include_inactive:
        stmt = stmt.where(StoreTable.is_active.is_(True))
    stmt = stmt.order_by(StoreTable.grid_y.asc(), StoreTable.grid_x.asc(), StoreTable.name.asc())
    return list(db.scalars(stmt).all())


def find_with_visits(db: Session, store_id: UUID, table_id: UUID) -> StoreTable | None:
    return db.scalars(
        select(StoreTable)
        .options(selectinload(StoreTable.visit_sessions).selectinload(VisitSession.slots))
        .where(StoreTable.id == table_id, StoreTable.store_id == store_id)
        .execution_options(populate_existing=True)
    ).first()


def insert(db: Session, table: StoreTable) -> None:
    db.add(table)
    db.flush()
