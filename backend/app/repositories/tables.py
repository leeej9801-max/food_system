from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import StoreTable, VisitSession

# 화면은 열린 방문만 쓴다. 지난 방문 이력 전체(수천 건)를 매번 읽지 않는다.
OPEN_VISIT_STATUSES = ("SEATED", "PAID")
_OPEN_VISITS = selectinload(
    StoreTable.visit_sessions.and_(VisitSession.status.in_(OPEN_VISIT_STATUSES))
).selectinload(VisitSession.slots)


def list_with_visits(
    db: Session, store_id: UUID, *, include_inactive: bool = False
) -> list[StoreTable]:
    """방문·자리까지 불러온다. 격자 위치 순."""
    stmt = (
        select(StoreTable)
        .options(_OPEN_VISITS)
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
        .options(_OPEN_VISITS)
        .where(StoreTable.id == table_id, StoreTable.store_id == store_id)
        .execution_options(populate_existing=True)
    ).first()


def insert(db: Session, table: StoreTable) -> None:
    db.add(table)
    db.flush()
