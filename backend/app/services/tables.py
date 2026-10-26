from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError
from app.db.models import StoreTable, VisitSession, utcnow
from app.schemas import (
    StoreTableCreate,
    StoreTableResponse,
    StoreTableUpdate,
    VisitSessionCreate,
    VisitSessionResponse,
    VisitSessionUpdate,
    VisitSummaryResponse,
)
from app.services.menus import get_store_or_404, record_audit


def _to_visit_response(session: VisitSession, table_name: str) -> VisitSessionResponse:
    status_val: Literal["SEATED", "PAID", "LEFT"] = (
        "PAID" if session.status == "PAID" else "LEFT" if session.status == "LEFT" else "SEATED"
    )
    return VisitSessionResponse(
        id=session.id,
        store_id=session.store_id,
        table_id=session.table_id,
        table_name=table_name,
        party_size=session.party_size,
        age_band=session.age_band,
        status=status_val,
        seated_at=session.seated_at,
        paid_at=session.paid_at,
        left_at=session.left_at,
        source=session.source,
        notes=session.notes,
    )


def _to_table_response(table: StoreTable) -> StoreTableResponse:
    active_sessions = [s for s in table.visit_sessions if s.status in ("SEATED", "PAID")]
    active_sessions.sort(key=lambda s: s.seated_at, reverse=True)
    active_visit = (
        _to_visit_response(active_sessions[0], table.name) if active_sessions else None
    )
    return StoreTableResponse(
        id=table.id,
        store_id=table.store_id,
        name=table.name,
        seats=table.seats,
        grid_x=table.grid_x,
        grid_y=table.grid_y,
        is_active=table.is_active,
        active_visit=active_visit,
        created_at=table.created_at,
        updated_at=table.updated_at,
    )


def list_tables(
    db: Session, *, store_id: str, include_inactive: bool = False
) -> list[StoreTableResponse]:
    get_store_or_404(db, store_id)
    stmt = (
        select(StoreTable)
        .options(selectinload(StoreTable.visit_sessions))
        .where(StoreTable.store_id == store_id)
        .execution_options(populate_existing=True)
    )
    if not include_inactive:
        stmt = stmt.where(StoreTable.is_active.is_(True))
    stmt = stmt.order_by(StoreTable.grid_y.asc(), StoreTable.grid_x.asc(), StoreTable.name.asc())
    tables = list(db.scalars(stmt).all())
    return [_to_table_response(t) for t in tables]


def get_table_or_404(db: Session, *, store_id: str, table_id: str) -> StoreTable:
    get_store_or_404(db, store_id)
    stmt = (
        select(StoreTable)
        .options(selectinload(StoreTable.visit_sessions))
        .where(StoreTable.id == table_id, StoreTable.store_id == store_id)
        .execution_options(populate_existing=True)
    )
    table = db.scalars(stmt).first()
    if table is None:
        raise AppError(status_code=404, code="TABLE_NOT_FOUND", message="테이블을 찾을 수 없습니다.")
    return table


def create_table(
    db: Session, *, store_id: str, payload: StoreTableCreate
) -> StoreTableResponse:
    get_store_or_404(db, store_id)
    table = StoreTable(
        store_id=store_id,
        name=payload.name,
        seats=payload.seats,
        grid_x=payload.grid_x,
        grid_y=payload.grid_y,
        is_active=payload.is_active,
    )
    db.add(table)
    db.flush()
    record_audit(
        db,
        store_id=store_id,
        entity_type="store_table",
        entity_id=table.id,
        action="created",
        summary={
            "after": {
                "name": table.name,
                "seats": table.seats,
                "grid_x": table.grid_x,
                "grid_y": table.grid_y,
            }
        },
    )
    db.commit()
    return _to_table_response(get_table_or_404(db, store_id=store_id, table_id=table.id))


def update_table(
    db: Session, *, store_id: str, table_id: str, payload: StoreTableUpdate
) -> StoreTableResponse:
    table = get_table_or_404(db, store_id=store_id, table_id=table_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        return _to_table_response(table)

    for k, v in data.items():
        if v is None:
            continue
        setattr(table, k, v)
    table.updated_at = utcnow()
    db.commit()
    return _to_table_response(get_table_or_404(db, store_id=store_id, table_id=table.id))


def create_visit_session(
    db: Session, *, store_id: str, payload: VisitSessionCreate
) -> VisitSessionResponse:
    table = get_table_or_404(db, store_id=store_id, table_id=payload.table_id)
    if not table.is_active:
        raise AppError(
            status_code=422,
            code="TABLE_INACTIVE",
            message="비활성화된 테이블에는 착석 기록을 시작할 수 없습니다.",
        )

    active = [s for s in table.visit_sessions if s.status in ("SEATED", "PAID")]
    if active:
        raise AppError(
            status_code=409,
            code="TABLE_ALREADY_OCCUPIED",
            message=f"테이블 '{table.name}'에 이미 진행 중인 착석 세션이 있습니다.",
        )

    visit = VisitSession(
        store_id=store_id,
        table_id=table.id,
        party_size=payload.party_size,
        age_band=payload.age_band,
        status="SEATED",
        seated_at=utcnow(),
        source="manual",
        notes=payload.notes.strip() if payload.notes else None,
    )
    db.add(visit)
    db.flush()
    record_audit(
        db,
        store_id=store_id,
        entity_type="visit_session",
        entity_id=visit.id,
        action="seated",
        summary={
            "table_name": table.name,
            "party_size": visit.party_size,
            "age_band": visit.age_band,
        },
    )
    db.commit()
    db.refresh(visit)
    return _to_visit_response(visit, table.name)


def update_visit_session(
    db: Session, *, store_id: str, visit_id: str, payload: VisitSessionUpdate
) -> VisitSessionResponse:
    get_store_or_404(db, store_id)
    stmt = (
        select(VisitSession)
        .options(selectinload(VisitSession.table))
        .where(VisitSession.id == visit_id, VisitSession.store_id == store_id)
    )
    visit = db.scalars(stmt).first()
    if visit is None:
        raise AppError(
            status_code=404,
            code="VISIT_NOT_FOUND",
            message="방문 세션을 찾을 수 없습니다.",
        )

    data = payload.model_dump(exclude_unset=True)
    before = {
        "party_size": visit.party_size,
        "age_band": visit.age_band,
        "status": visit.status,
    }

    if "party_size" in data and data["party_size"] is not None:
        visit.party_size = data["party_size"]
    if "age_band" in data and data["age_band"] is not None:
        visit.age_band = data["age_band"]
    if "notes" in data:
        visit.notes = data["notes"].strip() if data["notes"] else None

    if "status" in data and data["status"] is not None:
        next_status = data["status"]
        # 결제 완료(PAID)와 실제 퇴점(LEFT)을 명확히 분리
        if next_status == "PAID":
            visit.status = "PAID"
            if visit.paid_at is None:
                visit.paid_at = utcnow()
        elif next_status == "LEFT":
            visit.status = "LEFT"
            if visit.left_at is None:
                visit.left_at = utcnow()
        elif next_status == "SEATED":
            visit.status = "SEATED"

    after = {
        "party_size": visit.party_size,
        "age_band": visit.age_band,
        "status": visit.status,
    }
    record_audit(
        db,
        store_id=store_id,
        entity_type="visit_session",
        entity_id=visit.id,
        action=f"status_{visit.status.lower()}",
        summary={"before": before, "after": after},
    )
    db.commit()
    db.refresh(visit)
    return _to_visit_response(visit, visit.table.name)


def list_visit_summary(db: Session, *, store_id: str) -> VisitSummaryResponse:
    get_store_or_404(db, store_id)
    stmt = (
        select(VisitSession)
        .options(selectinload(VisitSession.table))
        .where(VisitSession.store_id == store_id)
        .order_by(VisitSession.seated_at.desc())
        .execution_options(populate_existing=True)
    )
    sessions = list(db.scalars(stmt).all())
    active_sessions = [s for s in sessions if s.status in ("SEATED", "PAID")]
    return VisitSummaryResponse(
        active_table_count=len(active_sessions),
        active_guest_count=sum(s.party_size for s in active_sessions),
        total_visit_count=len(sessions),
        total_guest_count=sum(s.party_size for s in sessions),
        sessions=[_to_visit_response(s, s.table.name) for s in sessions],
    )
