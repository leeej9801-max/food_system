from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import VisitSession


def add(db: Session, visit: VisitSession) -> None:
    """flush하지 않는다. 테이블당 열린 세션 1개 제약 위반은 호출한 쪽이 flush에서 잡는다."""
    db.add(visit)


def find_with_table_and_slots(db: Session, store_id: UUID, visit_id: UUID) -> VisitSession | None:
    return db.scalars(
        select(VisitSession)
        .options(selectinload(VisitSession.table), selectinload(VisitSession.slots))
        .where(VisitSession.id == visit_id, VisitSession.store_id == store_id)
    ).first()


def list_with_table_and_slots(db: Session, store_id: UUID) -> list[VisitSession]:
    """최근 착석 먼저."""
    return list(
        db.scalars(
            select(VisitSession)
            .options(selectinload(VisitSession.table), selectinload(VisitSession.slots))
            .where(VisitSession.store_id == store_id)
            .order_by(VisitSession.seated_at.desc())
            .execution_options(populate_existing=True)
        ).all()
    )
