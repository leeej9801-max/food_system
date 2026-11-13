"""손님 API (/api/guest/v1). 경로에는 QR 토큰만 있고 매장 ID는 받지 않는다 (ADR-013)."""

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.schemas import (
    GuestSessionContextUpdate,
    GuestSessionOpen,
    GuestSlotDisplayUpdate,
    GuestTableResponse,
)
from app.services import guest as guest_service
from app.services.guest import GuestScope

DEVICE_COOKIE = "food_guest_device"
DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

guest_router = APIRouter(prefix="/qr/{token}", tags=["guest"])


def guest_scope(
    token: str,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    food_guest_device: Annotated[str | None, Cookie()] = None,
) -> GuestScope:
    scope, new_raw = guest_service.enter_guest_scope(db, token, food_guest_device)
    if new_raw is not None:
        response.set_cookie(
            DEVICE_COOKIE,
            new_raw,
            max_age=DEVICE_COOKIE_MAX_AGE,
            httponly=True,
            samesite="lax",
            secure=settings.guest_cookie_secure,
            path="/",
        )
    return scope


@guest_router.get("")
def get_table(
    scope: Annotated[GuestScope, Depends(guest_scope)], db: Annotated[Session, Depends(get_db)]
) -> GuestTableResponse:
    return guest_service.view_table(db, scope)


@guest_router.post("/session")
def open_session(
    payload: GuestSessionOpen,
    scope: Annotated[GuestScope, Depends(guest_scope)],
    db: Annotated[Session, Depends(get_db)],
) -> GuestTableResponse:
    return guest_service.open_or_join(db, scope, payload)


@guest_router.post("/session/slots")
def add_slot(
    scope: Annotated[GuestScope, Depends(guest_scope)], db: Annotated[Session, Depends(get_db)]
) -> GuestTableResponse:
    return guest_service.add_slot(db, scope)


@guest_router.delete("/session/slots/{slot_no}")
def remove_slot(
    slot_no: int,
    scope: Annotated[GuestScope, Depends(guest_scope)],
    db: Annotated[Session, Depends(get_db)],
) -> GuestTableResponse:
    return guest_service.remove_slot(db, scope, slot_no)


@guest_router.post("/session/slots/{slot_no}/claim")
def claim_slot(
    slot_no: int,
    scope: Annotated[GuestScope, Depends(guest_scope)],
    db: Annotated[Session, Depends(get_db)],
) -> GuestTableResponse:
    return guest_service.claim_slot(db, scope, slot_no)


@guest_router.patch("/session/slots/{slot_no}")
def update_slot(
    slot_no: int,
    payload: GuestSlotDisplayUpdate,
    scope: Annotated[GuestScope, Depends(guest_scope)],
    db: Annotated[Session, Depends(get_db)],
) -> GuestTableResponse:
    return guest_service.update_my_slot(db, scope, slot_no, payload)


@guest_router.patch("/session")
def update_session(
    payload: GuestSessionContextUpdate,
    scope: Annotated[GuestScope, Depends(guest_scope)],
    db: Annotated[Session, Depends(get_db)],
) -> GuestTableResponse:
    return guest_service.update_session_context(db, scope, payload)
