from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class OAuthStart(BaseModel):
    store_id: UUID
    invite_token: str | None = Field(default=None, min_length=40, max_length=100)


class OAuthStartResponse(BaseModel):
    authorize_url: str


class QRRecord(BaseModel):
    qr_token: str = Field(min_length=40, max_length=100, pattern=r"^[0-9]{1,12}\.[0-9a-f]{64}$")
    client_event_id: UUID


class StaffMe(BaseModel):
    staff_id: UUID
    name: str
    status: Literal["PENDING", "ACTIVE"]


class Recorded(BaseModel):
    event_id: UUID
    name: str
    kind: Literal["IN", "OUT"]
    occurred_at: datetime

    @field_validator("occurred_at")
    @classmethod
    def utc_time(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class QRResponse(BaseModel):
    svg: str
    server_now: datetime
    expires_at: datetime
    provisional: bool = True


class QRStatus(BaseModel):
    completed: Recorded | None
    provisional: bool = True


class InviteResponse(BaseModel):
    url: str
    expires_at: datetime
    provisional: bool = True


class IdentityResponse(BaseModel):
    staff_id: UUID
    name: str
    nickname: str | None
    status: Literal["UNLINKED", "PENDING", "ACTIVE"]
    provisional: bool = True
