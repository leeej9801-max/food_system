from datetime import UTC, date, datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class StaffCreate(Input):
    name: str = Field(min_length=1, max_length=50)
    role: Literal["HALL", "KITCHEN"]
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class StaffResponse(StaffCreate):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    status: Literal["ACTIVE", "INACTIVE"]


class ShiftTime(Input):
    start_minute: int = Field(ge=0, le=1380, strict=True)
    end_minute: int = Field(ge=60, le=1440, strict=True)
    label: str = Field(default="수동 설정", min_length=1, max_length=30)

    @model_validator(mode="after")
    def validate_time(self):
        if self.end_minute - self.start_minute < 60:
            raise ValueError("퇴근은 출근보다 최소 1시간 뒤여야 합니다.")
        if self.start_minute % 30 or self.end_minute % 30:
            raise ValueError("스케줄은 30분 단위로 설정해 주세요.")
        return self


class ShiftCreate(ShiftTime):
    staff_id: UUID | None = None
    dates: list[date] = Field(min_length=1, max_length=31)

    @field_validator("dates")
    @classmethod
    def unique_dates(cls, dates):
        if len(set(dates)) != len(dates):
            raise ValueError("날짜가 중복되었습니다.")
        return dates


class ShiftResponse(ShiftTime):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    staff_id: UUID | None
    work_date: date


class Preset(ShiftTime):
    key: Literal["AM", "PM", "OPEN", "CLOSE"]


class PresetsUpdate(Input):
    presets: list[Preset] = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def unique_keys(self):
        if len({p.key for p in self.presets}) != 4:
            raise ValueError("유형별로 하나씩 설정해 주세요.")
        return self


class EventCreate(Input):
    staff_id: UUID
    kind: Literal["IN", "OUT"]
    client_event_id: UUID


class CorrectionItem(Input):
    event_id: UUID | None = None
    previous_correction_id: UUID | None = None
    corrected_kind: Literal["IN", "OUT"]
    corrected_at: AwareDatetime


class CorrectionsCreate(Input):
    staff_id: UUID
    reason: str = Field(min_length=1, max_length=1000)
    items: list[CorrectionItem] = Field(min_length=1, max_length=2)


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    client_event_id: UUID
    staff_id: UUID
    kind: str
    occurred_at: datetime
    created_at: datetime
    device_id: UUID | None

    @field_validator("occurred_at", "created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class CorrectionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    staff_id: UUID
    event_id: UUID | None
    previous_correction_id: UUID | None
    corrected_kind: str
    corrected_at: datetime
    reason: str
    corrected_by_user_id: UUID | None
    created_at: datetime

    @field_validator("corrected_at", "created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class WorkSession(BaseModel):
    staff_id: UUID
    in_id: UUID
    out_id: UUID | None
    in_event_id: UUID | None
    out_event_id: UUID | None
    started_at: datetime
    ended_at: datetime | None
    minutes: int | None
    missing: bool


class StaffSummary(BaseModel):
    staff_id: UUID
    planned_minutes: int
    actual_minutes: int
    overtime_minutes: int
    missing_count: int
    last_kind: Literal["IN", "OUT"] | None
    status: Literal["WORKING", "EXPECTED", "OUT", "MISSING", "NONE"]


class Gap(BaseModel):
    work_date: date
    started_at: datetime
    ended_at: datetime


class AttendanceResponse(BaseModel):
    start: date
    end: date
    now: datetime
    staff: list[StaffResponse]
    shifts: list[ShiftResponse]
    presets: list[Preset]
    events: list[EventResponse]
    corrections: list[CorrectionResponse]
    sessions: list[WorkSession]
    summary: list[StaffSummary]
    gaps: list[Gap]
    provisional: bool = True
