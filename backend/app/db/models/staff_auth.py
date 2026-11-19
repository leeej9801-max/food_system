import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models import new_uuid, utcnow


class StaffIdentity(Base):
    __tablename__ = "staff_identities"
    __table_args__ = (
        UniqueConstraint("store_id", "staff_id"),
        UniqueConstraint("store_id", "kakao_id"),
        CheckConstraint("status IN ('PENDING', 'ACTIVE')"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("stores.id"), index=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("staff.id"))
    kakao_id: Mapped[str] = mapped_column(String(64))
    nickname: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(10), default="PENDING")


class StaffInvite(Base):
    __tablename__ = "staff_invites"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("stores.id"), index=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("staff.id"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class StaffSession(Base):
    __tablename__ = "staff_sessions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("stores.id"), index=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("staff.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class StaffRefresh(Base):
    __tablename__ = "staff_refresh_tokens"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("stores.id"), index=True)
    session_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("staff_sessions.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class StaffOAuthState(Base):
    __tablename__ = "staff_oauth_states"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("stores.id"), index=True)
    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AttendanceQRSecret(Base):
    __tablename__ = "attendance_qr_secrets"
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("stores.id"), primary_key=True)
    secret: Mapped[str] = mapped_column(String(64))


class AttendanceQRUse(Base):
    """QR 토큰은 저장하지 않고 사용 직원/시간창과 원본만 보존한다."""

    __tablename__ = "attendance_qr_uses"
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("stores.id"), primary_key=True)
    staff_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("staff.id"), primary_key=True)
    window: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("attendance_events.id"))
