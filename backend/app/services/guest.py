"""손님 영역 B 1단계: 테이블 QR → 방문 세션 열기/합류, 1명 단위 슬롯 (WO-20261104-003).

손님 요청에는 매장 ID가 없다. QR 토큰으로 서버가 매장·테이블을 찾아 그 매장 범위를 건다
(ADR-013). 기기는 익명 쿠키 토큰의 해시로만 구분하고 개인정보는 받지 않는다 (U-23).
"""

import hashlib
import secrets
from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError
from app.db.models import GuestDevice, SessionSlot, StoreTable, TableQrToken, VisitSession, utcnow
from app.db.tenancy import RequestContext, bind_store_scope
from app.schemas import (
    GuestSessionContextUpdate,
    GuestSessionOpen,
    GuestSessionResponse,
    GuestSlotDisplayUpdate,
    GuestSlotResponse,
    GuestTableResponse,
    TableQrTokenResponse,
)
from app.services.menus import record_audit
from app.services.visit_profile import (
    apply_slot_profile,
    apply_visit_context,
    close_expired_sessions,
)

OPEN_STATUSES = ("SEATED", "PAID")
REMOVABLE_STATES = ("EMPTY", "SILHOUETTE")
GUEST_ACTOR = "guest-device"
MAX_SLOTS = 20  # GuestSessionOpen.party_size 상한과 같다


# --- 슬롯 (직원 API와 함께 쓴다) ---


def add_slots(db: Session, visit: VisitSession, count: int, device_id: str | None = None) -> None:
    start = max((s.slot_no for s in visit.slots), default=0)
    for i in range(1, count + 1):
        slot = SessionSlot(
            store_id=visit.store_id,
            session_id=visit.id,
            slot_no=start + i,
            state="SILHOUETTE",
            created_by_device_id=device_id,
        )
        db.add(slot)
        visit.slots.append(slot)


def _removable(slot: SessionSlot) -> bool:
    return slot.state in REMOVABLE_STATES and slot.claimed_by_device_id is None


def sync_slots_to_party_size(db: Session, visit: VisitSession) -> None:
    """직원이 인원수를 바꾸면 슬롯 수를 맞춘다. 캐릭터가 있거나 가져간 슬롯은 지우지 않는다."""
    diff = visit.party_size - len(visit.slots)
    if diff > 0:
        add_slots(db, visit, diff)
        return
    for slot in sorted(visit.slots, key=lambda s: s.slot_no, reverse=True):
        if diff == 0:
            break
        if _removable(slot):
            visit.slots.remove(slot)
            db.delete(slot)
            diff += 1
    # 지울 수 없는 슬롯이 남으면 인원수가 슬롯 수보다 작아지지 않게 한다
    visit.party_size = len(visit.slots)


# --- QR 토큰 (직원 API) ---


def issue_qr_token(db: Session, *, store_id: str, table_id: str) -> TableQrTokenResponse:
    """발급 또는 회전. 회전하면 이전 토큰은 바로 쓸 수 없다."""
    row = db.scalars(
        select(TableQrToken).where(
            TableQrToken.store_id == store_id, TableQrToken.table_id == table_id
        )
    ).first()
    now = utcnow()
    if row is None:
        row = TableQrToken(store_id=store_id, table_id=table_id, rotated_at=now)
        db.add(row)
    row.token = secrets.token_urlsafe(24)
    row.rotated_at = now
    db.flush()
    record_audit(
        db,
        store_id=store_id,
        entity_type="table_qr_token",
        entity_id=row.id,
        action="rotated",
        summary={"table_id": table_id},  # 토큰 원문은 감사 로그에 남기지 않는다
    )
    db.commit()
    return TableQrTokenResponse(table_id=table_id, token=row.token, rotated_at=row.rotated_at)


def get_qr_token(db: Session, *, store_id: str, table_id: str) -> TableQrTokenResponse:
    row = db.scalars(
        select(TableQrToken).where(
            TableQrToken.store_id == store_id, TableQrToken.table_id == table_id
        )
    ).first()
    if row is None:
        raise AppError(
            status_code=404, code="QR_TOKEN_NOT_FOUND", message="이 테이블의 QR이 아직 없습니다."
        )
    return TableQrTokenResponse(table_id=table_id, token=row.token, rotated_at=row.rotated_at)


# --- 손님 요청 범위 ---


@dataclass(frozen=True)
class GuestScope:
    store_id: str
    table_id: str
    device_id: str


def _not_found() -> AppError:
    # 토큰이 없는지, 테이블이 꺼졌는지 구분해서 알려주지 않는다
    return AppError(status_code=404, code="QR_TOKEN_NOT_FOUND", message="QR을 다시 확인해 주세요.")


def resolve_qr_token(db: Session, token: str) -> tuple[str, str] | None:
    if not token or len(token) > 64:
        return None
    if db.get_bind().dialect.name == "postgresql":
        # 매장 범위가 정해지기 전이라 RLS 아래에서는 직접 못 읽는다. 토큰 1개만 푸는 함수 (alembic 0007)
        row = db.execute(
            text("SELECT store_id, table_id FROM app_resolve_table_qr(:token)"), {"token": token}
        ).first()
    else:
        # SQLite에는 RLS가 없다 (P-07)
        row = db.execute(
            select(TableQrToken.store_id, TableQrToken.table_id).where(TableQrToken.token == token)
        ).first()
    return (row[0], row[1]) if row else None


def hash_device_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_or_create_device(db: Session, raw_token: str | None) -> tuple[GuestDevice, str | None]:
    """기기 토큰을 확인한다. 새로 만들면 (기기, 새 원문 토큰)을, 아니면 (기기, None)을 돌려준다."""
    if raw_token and len(raw_token) <= 128:
        device = db.scalars(
            select(GuestDevice).where(GuestDevice.token_hash == hash_device_token(raw_token))
        ).first()
        if device is not None:
            device.last_seen_at = utcnow()
            return device, None
    new_raw = secrets.token_urlsafe(32)
    device = GuestDevice(token_hash=hash_device_token(new_raw))
    db.add(device)
    db.flush()
    return device, new_raw


def enter_guest_scope(
    db: Session, token: str, raw_device_token: str | None
) -> tuple[GuestScope, str | None]:
    resolved = resolve_qr_token(db, token)
    if resolved is None:
        raise _not_found()
    store_id, table_id = resolved
    bind_store_scope(db, RequestContext(store_id=store_id, actor=GUEST_ACTOR))
    table = _get_table(db, store_id, table_id)
    if table is None or not table.is_active:
        raise _not_found()
    device, new_raw = get_or_create_device(db, raw_device_token)
    close_expired_sessions(db, store_id)  # 지난 영업일 세션에 합류하지 않게
    db.commit()
    return GuestScope(store_id=store_id, table_id=table_id, device_id=device.id), new_raw


# --- 손님 동작 ---


def _get_table(db: Session, store_id: str, table_id: str) -> StoreTable | None:
    return db.scalars(
        select(StoreTable).where(StoreTable.id == table_id, StoreTable.store_id == store_id)
    ).first()


def _open_session(db: Session, scope: GuestScope) -> VisitSession | None:
    return db.scalars(
        select(VisitSession)
        .options(selectinload(VisitSession.slots))
        .where(
            VisitSession.store_id == scope.store_id,
            VisitSession.table_id == scope.table_id,
            VisitSession.status.in_(OPEN_STATUSES),
        )
        .execution_options(populate_existing=True)
    ).first()


def _require_open_session(db: Session, scope: GuestScope) -> VisitSession:
    visit = _open_session(db, scope)
    if visit is None:
        raise AppError(
            status_code=409,
            code="NO_OPEN_SESSION",
            message="이 테이블에 열린 방문 기록이 없습니다.",
        )
    return visit


def _get_slot(visit: VisitSession, slot_no: int) -> SessionSlot:
    for slot in visit.slots:
        if slot.slot_no == slot_no:
            return slot
    raise AppError(status_code=404, code="SLOT_NOT_FOUND", message="자리를 찾을 수 없습니다.")


def _to_session(visit: VisitSession, device_id: str) -> GuestSessionResponse:
    return GuestSessionResponse(
        party_size=visit.party_size,
        party_size_source=visit.party_size_source,
        opened_at=visit.seated_at,
        purpose=visit.purpose,
        relationship=visit.relationship_type,
        slots=[
            GuestSlotResponse(
                slot_no=s.slot_no,
                state=s.state,
                is_claimed=s.claimed_by_device_id is not None,
                is_mine=s.claimed_by_device_id == device_id,
                display_opt_out=s.display_opt_out,
                gender=s.gender,
                age_band=s.age_band,
            )
            for s in sorted(visit.slots, key=lambda s: s.slot_no)
        ],
    )


def view_table(db: Session, scope: GuestScope, **flags: bool) -> GuestTableResponse:
    table = _get_table(db, scope.store_id, scope.table_id)
    if table is None:
        raise _not_found()
    visit = _open_session(db, scope)
    return GuestTableResponse(
        table_name=table.name,
        seats=table.seats,
        session=_to_session(visit, scope.device_id) if visit else None,
        **flags,
    )


def _create_session(db: Session, scope: GuestScope, party_size: int) -> None:
    visit = VisitSession(
        store_id=scope.store_id,
        table_id=scope.table_id,
        party_size=party_size,
        status="SEATED",
        seated_at=utcnow(),
        source="guest_qr",
        party_size_source="GUEST_QR",
        opened_by="GUEST_QR",
    )
    visit.slots = []
    db.add(visit)
    db.flush()
    add_slots(db, visit, party_size, device_id=scope.device_id)
    record_audit(
        db,
        store_id=scope.store_id,
        entity_type="visit_session",
        entity_id=visit.id,
        action="seated",
        summary={"party_size": party_size, "opened_by": "GUEST_QR"},
        actor=GUEST_ACTOR,
    )


def open_or_join(db: Session, scope: GuestScope, payload: GuestSessionOpen) -> GuestTableResponse:
    visit = _open_session(db, scope)

    if visit is not None and payload.new_party:
        # 케이스 H: 이전 손님 세션이 안 닫혔다. 손님이 "지금 앉았다"고 확인했으므로 닫고 새로 연다
        visit.status = "LEFT"
        visit.left_at = utcnow()
        visit.closed_reason = "NEXT_PARTY"
        record_audit(
            db,
            store_id=scope.store_id,
            entity_type="visit_session",
            entity_id=visit.id,
            action="status_left",
            summary={"closed_reason": "NEXT_PARTY"},
            actor=GUEST_ACTOR,
        )
        db.flush()
        visit = None

    if visit is not None:
        mismatch = payload.party_size is not None and payload.party_size != visit.party_size
        if (
            visit.party_size_source != "GUEST_QR"
            and payload.party_size is not None
            and not mismatch
        ):
            # U-18: 손님이 확인한 인원수가 직원 입력보다 우선
            visit.party_size_source = "GUEST_QR"
        db.commit()
        return view_table(db, scope, joined=True, party_size_mismatch=mismatch)

    if payload.party_size is None:
        raise AppError(status_code=422, code="PARTY_SIZE_REQUIRED", message="인원수를 골라 주세요.")
    try:
        _create_session(db, scope, payload.party_size)
        db.commit()
    except IntegrityError:
        # 같은 테이블에서 동시에 열었다. 먼저 저장된 세션에 합류한다
        db.rollback()
        return view_table(db, scope, joined=True)
    return view_table(db, scope)


def add_slot(db: Session, scope: GuestScope) -> GuestTableResponse:
    visit = _require_open_session(db, scope)
    if len(visit.slots) >= MAX_SLOTS:
        raise AppError(
            status_code=409, code="SLOT_LIMIT", message=f"한 테이블은 {MAX_SLOTS}자리까지입니다."
        )
    add_slots(db, visit, 1, device_id=scope.device_id)
    visit.party_size = len(visit.slots)
    table = _get_table(db, scope.store_id, scope.table_id)
    over = table is not None and visit.party_size > table.seats
    db.commit()
    return view_table(db, scope, over_seats=over)


def remove_slot(db: Session, scope: GuestScope, slot_no: int) -> GuestTableResponse:
    visit = _require_open_session(db, scope)
    slot = _get_slot(visit, slot_no)
    if not _removable(slot) or len(visit.slots) <= 1:
        raise AppError(
            status_code=409,
            code="SLOT_NOT_REMOVABLE",
            message="빈 자리만 뺄 수 있고, 최소 1자리는 남아야 합니다.",
        )
    visit.slots.remove(slot)
    db.delete(slot)
    visit.party_size = len(visit.slots)
    db.commit()
    return view_table(db, scope)


def claim_slot(db: Session, scope: GuestScope, slot_no: int) -> GuestTableResponse:
    visit = _require_open_session(db, scope)
    slot = _get_slot(visit, slot_no)
    if slot.claimed_by_device_id not in (None, scope.device_id):
        raise AppError(
            status_code=409, code="SLOT_ALREADY_CLAIMED", message="다른 분이 이미 고른 자리입니다."
        )
    slot.claimed_by_device_id = scope.device_id
    db.commit()
    return view_table(db, scope)


def update_my_slot(
    db: Session, scope: GuestScope, slot_no: int, payload: GuestSlotDisplayUpdate
) -> GuestTableResponse:
    """내 자리의 화면 표시 여부와 성별·연령대를 바꾼다. 남의 자리는 403."""
    visit = _require_open_session(db, scope)
    slot = _get_slot(visit, slot_no)
    if slot.claimed_by_device_id != scope.device_id:
        raise AppError(
            status_code=403, code="SLOT_NOT_MINE", message="내 자리만 바꿀 수 있습니다."
        )
    if payload.display_opt_out is not None:
        slot.display_opt_out = payload.display_opt_out
    apply_slot_profile(
        visit, slot, source="GUEST", gender=payload.gender, age_band=payload.age_band
    )
    db.commit()
    return view_table(db, scope)


def update_session_context(
    db: Session, scope: GuestScope, payload: GuestSessionContextUpdate
) -> GuestTableResponse:
    """방문 목적·동반 관계는 세션 단위로 손님 누구나 고른다(U-31). 손님 값이 직원 값보다 우선."""
    visit = _require_open_session(db, scope)
    apply_visit_context(
        visit, source="GUEST", purpose=payload.purpose, relationship=payload.relationship
    )
    db.commit()
    return view_table(db, scope)
