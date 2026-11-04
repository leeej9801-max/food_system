"""손님 API (/api/guest/v1). 경로에는 QR 토큰만 있고 매장 ID는 받지 않는다 (ADR-013)."""

from fastapi import APIRouter, Cookie, Depends, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.schemas import GuestSessionOpen, GuestSlotDisplayUpdate, GuestTableResponse
from app.services import guest as guest_service
from app.services.guest import GuestScope

DEVICE_COOKIE = "food_guest_device"
DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

guest_router = APIRouter(prefix="/qr/{token}", tags=["guest"])


def guest_scope(
    token: str,
    response: Response,
    db: Session = Depends(get_db),
    food_guest_device: str | None = Cookie(default=None),
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


@guest_router.get("", response_model=GuestTableResponse)
def get_table(
    scope: GuestScope = Depends(guest_scope), db: Session = Depends(get_db)
) -> GuestTableResponse:
    return guest_service.view_table(db, scope)


@guest_router.post("/session", response_model=GuestTableResponse)
def open_session(
    payload: GuestSessionOpen,
    scope: GuestScope = Depends(guest_scope),
    db: Session = Depends(get_db),
) -> GuestTableResponse:
    return guest_service.open_or_join(db, scope, payload)


@guest_router.post("/session/slots", response_model=GuestTableResponse)
def add_slot(
    scope: GuestScope = Depends(guest_scope), db: Session = Depends(get_db)
) -> GuestTableResponse:
    return guest_service.add_slot(db, scope)


@guest_router.delete("/session/slots/{slot_no}", response_model=GuestTableResponse)
def remove_slot(
    slot_no: int, scope: GuestScope = Depends(guest_scope), db: Session = Depends(get_db)
) -> GuestTableResponse:
    return guest_service.remove_slot(db, scope, slot_no)


@guest_router.post("/session/slots/{slot_no}/claim", response_model=GuestTableResponse)
def claim_slot(
    slot_no: int, scope: GuestScope = Depends(guest_scope), db: Session = Depends(get_db)
) -> GuestTableResponse:
    return guest_service.claim_slot(db, scope, slot_no)


@guest_router.patch("/session/slots/{slot_no}", response_model=GuestTableResponse)
def update_slot_display(
    slot_no: int,
    payload: GuestSlotDisplayUpdate,
    scope: GuestScope = Depends(guest_scope),
    db: Session = Depends(get_db),
) -> GuestTableResponse:
    return guest_service.set_display_opt_out(db, scope, slot_no, payload.display_opt_out)
