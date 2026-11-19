"""근태 원본과 정정은 별도 행으로 보존한다 (인증 설계 §6.4)."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models import new_uuid, utcnow


class Staff(Base):
    __tablename__ = "staff"
    __table_args__ = (
        CheckConstraint("role IN ('HALL', 'KITCHEN')"),
        CheckConstraint("status IN ('ACTIVE', 'INACTIVE')", name="ck_staff_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(50))
    role: Mapped[str] = mapped_column(String(10))
    color: Mapped[str] = mapped_column(String(7))
    status: Mapped[str] = mapped_column(String(8), default="ACTIVE", server_default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AttendanceShift(Base):
    __tablename__ = "attendance_shifts"
    __table_args__ = (
        Index("ix_attendance_shifts_store_date", "store_id", "work_date"),
        CheckConstraint(
            "start_minute >= 0 AND end_minute <= 1440 AND end_minute - start_minute >= 60"
        ),
        CheckConstraint("start_minute % 30 = 0 AND end_minute % 30 = 0"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), index=True
    )
    # null은 점주 단독 근무다. 직원 원본 출퇴근과 섞지 않는다.
    staff_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("staff.id", ondelete="RESTRICT")
    )
    work_date: Mapped[date] = mapped_column(Date, index=True)
    start_minute: Mapped[int] = mapped_column(Integer)
    end_minute: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(30), default="수동 설정")


class AttendancePreset(Base):
    __tablename__ = "attendance_presets"
    __table_args__ = (
        UniqueConstraint("store_id", "key"),
        CheckConstraint(
            "start_minute >= 0 AND end_minute <= 1440 AND end_minute - start_minute >= 60"
        ),
        CheckConstraint("start_minute % 30 = 0 AND end_minute % 30 = 0"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), index=True
    )
    key: Mapped[str] = mapped_column(String(10))
    label: Mapped[str] = mapped_column(String(30))
    start_minute: Mapped[int] = mapped_column(Integer)
    end_minute: Mapped[int] = mapped_column(Integer)


class AttendanceEvent(Base):
    __tablename__ = "attendance_events"
    __table_args__ = (
        CheckConstraint("kind IN ('IN', 'OUT')"),
        UniqueConstraint(
            "store_id", "staff_id", "client_event_id", name="uq_attendance_event_client"
        ),
        Index("ix_attendance_events_store_occurred", "store_id", "occurred_at"),
        Index("ix_attendance_events_store_staff_occurred", "store_id", "staff_id", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), index=True
    )
    staff_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("staff.id", ondelete="RESTRICT"), index=True
    )
    # PROVISIONAL: 기기 인증 구현 전에는 점주 화면 직접 등록이므로 null이다.
    device_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    client_event_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    kind: Mapped[str] = mapped_column(String(3))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AttendanceCorrection(Base):
    __tablename__ = "attendance_corrections"
    __table_args__ = (
        CheckConstraint("corrected_kind IN ('IN', 'OUT')"),
        CheckConstraint("length(trim(reason)) > 0"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), index=True
    )
    staff_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("staff.id", ondelete="RESTRICT"), index=True
    )
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("attendance_events.id", ondelete="RESTRICT")
    )
    # 누락 추가(null event_id)의 재정정도 원본 정정 행을 보존한다.
    previous_correction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("attendance_corrections.id", ondelete="RESTRICT")
    )
    corrected_kind: Mapped[str] = mapped_column(String(3))
    corrected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str] = mapped_column(Text)
    # PROVISIONAL: 로그인 구현 전 사용자 ID를 만들어 넣지 않는다.
    corrected_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_store_created", "store_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("stores.id", ondelete="RESTRICT"))
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(32))
    entity: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    before: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    after: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AttendanceEventRetry(Base):
    """60초 중복으로 반환한 원본과 새 요청 키의 연결도 재시도 때 보존한다."""

    __tablename__ = "attendance_event_retries"

    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), primary_key=True
    )
    staff_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("staff.id", ondelete="RESTRICT"), primary_key=True
    )
    client_event_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("attendance_events.id", ondelete="RESTRICT")
    )
