from uuid import UUID

from sqlalchemy import func, select
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


def list_with_table_and_slots(
    db: Session, store_id: UUID, *, limit: int | None = None
) -> list[VisitSession]:
    """최근 착석 먼저. limit이 없으면 전체."""
    stmt = (
        select(VisitSession)
        .options(selectinload(VisitSession.table), selectinload(VisitSession.slots))
        .where(VisitSession.store_id == store_id)
        .order_by(VisitSession.seated_at.desc())
        .execution_options(populate_existing=True)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    return list(db.scalars(stmt).all())


def count_totals(db: Session, store_id: UUID) -> tuple[int, int]:
    """(전체 방문 수, 전체 인원 수). 이력 행을 메모리로 올리지 않고 DB에서 센다."""
    visits, guests = db.execute(
        select(
            func.count(VisitSession.id), func.coalesce(func.sum(VisitSession.party_size), 0)
        ).where(VisitSession.store_id == store_id)
    ).one()
    return int(visits), int(guests)


def list_open_with_table_and_slots(db: Session, store_id: UUID) -> list[VisitSession]:
    """열린 방문(SEATED·PAID)만."""
    return list(
        db.scalars(
            select(VisitSession)
            .options(selectinload(VisitSession.table), selectinload(VisitSession.slots))
            .where(VisitSession.store_id == store_id, VisitSession.status.in_(("SEATED", "PAID")))
            .execution_options(populate_existing=True)
        ).all()
    )
