from datetime import date, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.attendance import (
    AttendanceCorrection,
    AttendanceEvent,
    AttendanceEventRetry,
    AttendancePreset,
    AttendanceShift,
    AuditLog,
    Staff,
)


def list_staff(db: Session, store_id: UUID, *, include_inactive: bool = False) -> list[Staff]:
    query = select(Staff).where(Staff.store_id == store_id)
    if not include_inactive:
        query = query.where(Staff.status == "ACTIVE")
    return list(db.scalars(query.order_by(Staff.created_at, Staff.id)))


def get_staff(db: Session, store_id: UUID, staff_id: UUID) -> Staff | None:
    return db.scalar(
        select(Staff).where(Staff.store_id == store_id, Staff.id == staff_id).with_for_update()
    )


def list_shifts(db: Session, store_id: UUID, start: date, end: date) -> list[AttendanceShift]:
    return list(
        db.scalars(
            select(AttendanceShift)
            .where(
                AttendanceShift.store_id == store_id,
                AttendanceShift.work_date >= start,
                AttendanceShift.work_date <= end,
            )
            .order_by(AttendanceShift.work_date, AttendanceShift.start_minute)
        )
    )


def get_shift(db: Session, store_id: UUID, shift_id: UUID) -> AttendanceShift | None:
    return db.scalar(
        select(AttendanceShift).where(
            AttendanceShift.store_id == store_id, AttendanceShift.id == shift_id
        )
    )


def list_presets(db: Session, store_id: UUID) -> list[AttendancePreset]:
    return list(db.scalars(select(AttendancePreset).where(AttendancePreset.store_id == store_id)))


def list_events(db: Session, store_id: UUID) -> list[AttendanceEvent]:
    return list(
        db.scalars(
            select(AttendanceEvent)
            .where(AttendanceEvent.store_id == store_id)
            .order_by(AttendanceEvent.occurred_at, AttendanceEvent.id)
        )
    )


def get_event_by_client_id(
    db: Session, store_id: UUID, staff_id: UUID, client_event_id: UUID
) -> AttendanceEvent | None:
    original = db.scalar(
        select(AttendanceEvent).where(
            AttendanceEvent.store_id == store_id,
            AttendanceEvent.staff_id == staff_id,
            AttendanceEvent.client_event_id == client_event_id,
        )
    )
    if original is not None:
        return original
    return db.scalar(
        select(AttendanceEvent)
        .join(AttendanceEventRetry, AttendanceEventRetry.event_id == AttendanceEvent.id)
        .where(
            AttendanceEvent.store_id == store_id,
            AttendanceEvent.staff_id == staff_id,
            AttendanceEventRetry.store_id == store_id,
            AttendanceEventRetry.staff_id == staff_id,
            AttendanceEventRetry.client_event_id == client_event_id,
        )
    )


def recent_event(
    db: Session, store_id: UUID, staff_id: UUID, kind: str, since: datetime, now: datetime
) -> AttendanceEvent | None:
    return db.scalar(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.store_id == store_id,
            AttendanceEvent.staff_id == staff_id,
            AttendanceEvent.kind == kind,
            AttendanceEvent.occurred_at >= since,
            AttendanceEvent.occurred_at <= now,
        )
        .order_by(AttendanceEvent.occurred_at.desc(), AttendanceEvent.id.desc())
        .limit(1)
    )


def list_corrections(db: Session, store_id: UUID) -> list[AttendanceCorrection]:
    return list(
        db.scalars(
            select(AttendanceCorrection)
            .where(AttendanceCorrection.store_id == store_id)
            .order_by(AttendanceCorrection.created_at, AttendanceCorrection.id)
        )
    )


def add(
    db: Session,
    row: Staff
    | AttendanceShift
    | AttendancePreset
    | AttendanceEvent
    | AttendanceCorrection
    | AuditLog
    | AttendanceEventRetry,
) -> None:
    db.add(row)
    db.flush()


def remove_shift(db: Session, row: AttendanceShift) -> None:
    db.delete(row)
