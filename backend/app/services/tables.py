from typing import Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError
from app.db.models import StoreTable, VisitSession, utcnow
from app.schemas import (
    SlotProfileUpdate,
    StoreTableCreate,
    StoreTableResponse,
    StoreTableUpdate,
    VisitSessionCreate,
    VisitSessionResponse,
    VisitSessionUpdate,
    VisitSlotResponse,
    VisitSummaryResponse,
)
from app.services.guest import add_slots, sync_slots_to_party_size
from app.services.menus import get_store_or_404, record_audit
from app.services.visit_profile import (
    apply_slot_profile,
    apply_visit_context,
    close_expired_sessions,
)


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
        party_size_source=session.party_size_source,
        opened_by=session.opened_by,
        closed_reason=session.closed_reason,
        purpose=session.purpose,
        relationship=session.relationship_type,
        context_source=session.context_source,
        slots=[
            VisitSlotResponse(
                slot_no=slot.slot_no,
                state=slot.state,
                is_claimed=slot.claimed_by_device_id is not None,
                gender=slot.gender,
                age_band=slot.age_band,
                profile_source=slot.profile_source,
            )
            for slot in sorted(session.slots, key=lambda slot: slot.slot_no)
        ],
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
        orientation=table.orientation,
        is_active=table.is_active,
        active_visit=active_visit,
        created_at=table.created_at,
        updated_at=table.updated_at,
    )


def list_tables(
    db: Session, *, store_id: str, include_inactive: bool = False
) -> list[StoreTableResponse]:
    get_store_or_404(db, store_id)
    if close_expired_sessions(db, store_id):
        db.commit()
    stmt = (
        select(StoreTable)
        .options(selectinload(StoreTable.visit_sessions).selectinload(VisitSession.slots))
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
        .options(selectinload(StoreTable.visit_sessions).selectinload(VisitSession.slots))
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
        orientation=payload.orientation,
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


def _occupied(table_name: str) -> AppError:
    return AppError(
        status_code=409,
        code="TABLE_ALREADY_OCCUPIED",
        message=f"테이블 '{table_name}'에 이미 진행 중인 착석 세션이 있습니다.",
    )


def create_visit_session(
    db: Session, *, store_id: str, payload: VisitSessionCreate
) -> VisitSessionResponse:
    get_store_or_404(db, store_id)
    close_expired_sessions(db, store_id)  # 어제 안 닫힌 세션이 새 착석을 막지 않게
    table = get_table_or_404(db, store_id=store_id, table_id=payload.table_id)
    if not table.is_active:
        raise AppError(
            status_code=422,
            code="TABLE_INACTIVE",
            message="비활성화된 테이블에는 착석 기록을 시작할 수 없습니다.",
        )

    active = [s for s in table.visit_sessions if s.status in ("SEATED", "PAID")]
    if active:
        raise _occupied(table.name)

    visit = VisitSession(
        store_id=store_id,
        table_id=table.id,
        party_size=payload.party_size,
        age_band=payload.age_band,
        status="SEATED",
        seated_at=utcnow(),
        source="manual",
        notes=payload.notes.strip() if payload.notes else None,
        party_size_source="STAFF",
        opened_by="STAFF",
    )
    visit.slots = []
    db.add(visit)
    table_name = table.name
    try:
        db.flush()
    except IntegrityError:
        # 손님 QR이 같은 순간 먼저 열었다 (테이블당 열린 세션 1개)
        db.rollback()
        raise _occupied(table_name) from None
    # U-17: 직원 입력만 있으면 인원수만큼 실루엣
    add_slots(db, visit, visit.party_size)
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
        .options(selectinload(VisitSession.table), selectinload(VisitSession.slots))
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
        sync_slots_to_party_size(db, visit)
    if "age_band" in data and data["age_band"] is not None:
        visit.age_band = data["age_band"]
    if "notes" in data:
        visit.notes = data["notes"].strip() if data["notes"] else None
    apply_visit_context(
        visit, source="STAFF", purpose=data.get("purpose"), relationship=data.get("relationship")
    )

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
            if visit.closed_reason is None:
                visit.closed_reason = "CLEARED"  # U-19: 직원이 치움
        elif next_status == "SEATED":
            visit.status = "SEATED"
        if visit.status != "LEFT":
            visit.closed_reason = None

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
    table_name = visit.table.name
    try:
        db.commit()
    except IntegrityError:
        # 닫은 세션을 다시 열려는데 그 테이블에 이미 새 세션이 있다
        db.rollback()
        raise _occupied(table_name) from None
    db.refresh(visit)
    return _to_visit_response(visit, visit.table.name)


def list_visit_summary(db: Session, *, store_id: str) -> VisitSummaryResponse:
    get_store_or_404(db, store_id)
    if close_expired_sessions(db, store_id):
        db.commit()
    stmt = (
        select(VisitSession)
        .options(selectinload(VisitSession.table), selectinload(VisitSession.slots))
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


def update_slot_profile(
    db: Session, *, store_id: str, visit_id: str, slot_no: int, payload: SlotProfileUpdate
) -> VisitSessionResponse:
    """직원이 사람별 성별·연령대를 입력한다. 손님이 입력한 자리는 409 (U-31)."""
    get_store_or_404(db, store_id)
    visit = db.scalars(
        select(VisitSession)
        .options(selectinload(VisitSession.table), selectinload(VisitSession.slots))
        .where(VisitSession.id == visit_id, VisitSession.store_id == store_id)
    ).first()
    if visit is None:
        raise AppError(
            status_code=404,
            code="VISIT_NOT_FOUND",
            message="방문 세션을 찾을 수 없습니다.",
        )
    slot = next((s for s in visit.slots if s.slot_no == slot_no), None)
    if slot is None:
        raise AppError(status_code=404, code="SLOT_NOT_FOUND", message="자리를 찾을 수 없습니다.")
    apply_slot_profile(
        visit, slot, source="STAFF", gender=payload.gender, age_band=payload.age_band
    )
    record_audit(
        db,
        store_id=store_id,
        entity_type="visit_session",
        entity_id=visit.id,
        action="slot_profile",
        summary={"slot_no": slot_no, "gender": slot.gender, "age_band": slot.age_band},
    )
    db.commit()
    db.refresh(visit)
    return _to_visit_response(visit, visit.table.name)
