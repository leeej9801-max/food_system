from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.attendance import (
    AttendanceResponse,
    CorrectionResponse,
    CorrectionsCreate,
    EventCreate,
    EventResponse,
    Preset,
    PresetsUpdate,
    ShiftCreate,
    ShiftResponse,
    ShiftTime,
    StaffCreate,
    StaffResponse,
)
from app.services import attendance as service

router = APIRouter(prefix="/stores/{store_id}/attendance", tags=["attendance"])
type DB = Annotated[Session, Depends(get_db)]


@router.get("")
def get_attendance(
    store_id: UUID, start: date, end: date, db: DB, include_inactive: bool = False
) -> AttendanceResponse:
    return service.get_attendance(db, store_id, start, end, include_inactive=include_inactive)


@router.get("/staff")
def list_staff(store_id: UUID, db: DB, include_inactive: bool = False) -> list[StaffResponse]:
    return [
        StaffResponse.model_validate(row)
        for row in service.list_staff(db, store_id, include_inactive=include_inactive)
    ]


@router.post("/staff", status_code=201)
def create_staff(store_id: UUID, payload: StaffCreate, db: DB) -> StaffResponse:
    return StaffResponse.model_validate(service.create_staff(db, store_id, payload))


@router.put("/staff/{staff_id}")
def update_staff(store_id: UUID, staff_id: UUID, payload: StaffCreate, db: DB) -> StaffResponse:
    return StaffResponse.model_validate(service.update_staff(db, store_id, staff_id, payload))


@router.delete("/staff/{staff_id}")
def deactivate_staff(store_id: UUID, staff_id: UUID, db: DB) -> dict[str, bool]:
    return service.deactivate_staff(db, store_id, staff_id)


@router.post("/shifts", status_code=201)
def create_shifts(store_id: UUID, payload: ShiftCreate, db: DB) -> list[ShiftResponse]:
    return service.save_shifts(db, store_id, payload)


@router.put("/shifts/{shift_id}")
def update_shift(store_id: UUID, shift_id: UUID, payload: ShiftTime, db: DB) -> ShiftResponse:
    return ShiftResponse.model_validate(service.update_shift(db, store_id, shift_id, payload))


@router.delete("/shifts/{shift_id}")
def delete_shift(store_id: UUID, shift_id: UUID, db: DB) -> dict[str, bool]:
    return service.delete_shift(db, store_id, shift_id)


@router.put("/presets")
def save_presets(store_id: UUID, payload: PresetsUpdate, db: DB) -> list[Preset]:
    return service.save_presets(db, store_id, payload)


@router.post("/events", status_code=201, responses={200: {"model": EventResponse}})
def record_event(store_id: UUID, payload: EventCreate, db: DB, response: Response) -> EventResponse:
    row, created = service.record_event(db, store_id, payload)
    response.status_code = 201 if created else 200
    return EventResponse.model_validate(row)


@router.post("/corrections", status_code=201)
def correct_events(store_id: UUID, payload: CorrectionsCreate, db: DB) -> list[CorrectionResponse]:
    return [
        CorrectionResponse.model_validate(row)
        for row in service.correct_events(db, store_id, payload)
    ]
