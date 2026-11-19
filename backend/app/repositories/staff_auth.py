from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models import AttendanceEvent, Staff, Store
from app.db.models.staff_auth import (
    AttendanceQRSecret,
    AttendanceQRUse,
    StaffIdentity,
    StaffInvite,
    StaffOAuthState,
    StaffRefresh,
    StaffSession,
)


def add(db: Session, row) -> None:
    db.add(row)
    db.flush()


def lock_store(db: Session, store_id: UUID) -> Store | None:
    return db.scalar(select(Store).where(Store.id == store_id).with_for_update())


def identity(
    db: Session, store_id: UUID, *, staff_id: UUID | None = None, kakao_id: str | None = None
) -> StaffIdentity | None:
    query = select(StaffIdentity).where(StaffIdentity.store_id == store_id)
    if staff_id is not None:
        query = query.where(StaffIdentity.staff_id == staff_id)
    if kakao_id is not None:
        query = query.where(StaffIdentity.kakao_id == kakao_id)
    return db.scalar(query.execution_options(populate_existing=True))


def identities(db: Session, store_id: UUID):
    return list(
        db.execute(
            select(Staff, StaffIdentity)
            .outerjoin(
                StaffIdentity,
                (StaffIdentity.staff_id == Staff.id) & (StaffIdentity.store_id == store_id),
            )
            .where(Staff.store_id == store_id, Staff.status == "ACTIVE")
            .order_by(Staff.created_at)
        )
    )


def invite(db: Session, store_id: UUID, token_hash: str) -> StaffInvite | None:
    return db.scalar(
        select(StaffInvite)
        .where(StaffInvite.store_id == store_id, StaffInvite.token_hash == token_hash)
        .with_for_update()
    )


def invalidate_invites(db: Session, store_id: UUID, staff_id: UUID, now: datetime):
    db.execute(
        update(StaffInvite)
        .where(
            StaffInvite.store_id == store_id,
            StaffInvite.staff_id == staff_id,
            StaffInvite.used_at.is_(None),
        )
        .values(used_at=now)
    )


def oauth_state(db: Session, store_id: UUID, token_hash: str) -> StaffOAuthState | None:
    return db.scalar(
        select(StaffOAuthState)
        .where(StaffOAuthState.store_id == store_id, StaffOAuthState.state_hash == token_hash)
        .with_for_update()
    )


def session(db: Session, store_id: UUID, session_id: UUID) -> StaffSession | None:
    return db.scalar(
        select(StaffSession)
        .where(StaffSession.store_id == store_id, StaffSession.id == session_id)
        .execution_options(populate_existing=True)
    )


def refresh(db: Session, store_id: UUID, token_hash: str, *, lock=False) -> StaffRefresh | None:
    query = select(StaffRefresh).where(
        StaffRefresh.store_id == store_id, StaffRefresh.token_hash == token_hash
    )
    if lock:
        query = query.with_for_update()
    return db.scalar(query.execution_options(populate_existing=True))


def revoke_staff(db: Session, store_id: UUID, staff_id: UUID, now: datetime):
    db.execute(
        update(StaffSession)
        .where(
            StaffSession.store_id == store_id,
            StaffSession.staff_id == staff_id,
            StaffSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )


def qr_secret(db: Session, store_id: UUID) -> AttendanceQRSecret | None:
    return db.scalar(select(AttendanceQRSecret).where(AttendanceQRSecret.store_id == store_id))


def qr_use(db: Session, store_id: UUID, staff_id: UUID, window: int) -> AttendanceQRUse | None:
    return db.scalar(
        select(AttendanceQRUse).where(
            AttendanceQRUse.store_id == store_id,
            AttendanceQRUse.staff_id == staff_id,
            AttendanceQRUse.window == window,
        )
    )


def qr_completion(db: Session, store_id: UUID, since: datetime, staff_id: UUID | None):
    query = (
        select(AttendanceEvent, Staff.name)
        .join(AttendanceQRUse, AttendanceQRUse.event_id == AttendanceEvent.id)
        .join(Staff, Staff.id == AttendanceEvent.staff_id)
        .where(
            AttendanceEvent.store_id == store_id,
            AttendanceQRUse.store_id == store_id,
            AttendanceEvent.occurred_at >= since,
        )
    )
    if staff_id:
        query = query.where(AttendanceEvent.staff_id == staff_id)
    return db.execute(query.order_by(AttendanceEvent.occurred_at.desc()).limit(1)).first()
