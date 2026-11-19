from typing import Annotated
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.staff_security import limiter, protect_change
from app.db.session import get_db
from app.schemas.staff_auth import (
    IdentityResponse,
    InviteResponse,
    OAuthStart,
    OAuthStartResponse,
    QRRecord,
    QRResponse,
    QRStatus,
    Recorded,
    StaffMe,
)
from app.services import staff_auth as service

router = APIRouter(tags=["staff-auth"])
owner = APIRouter(prefix="/stores/{store_id}/attendance", tags=["staff-auth-provisional"])
mobile = APIRouter(prefix="/stores/{store_id}/staff-access", tags=["staff-auth"])
type DB = Annotated[Session, Depends(get_db)]
type Change = Annotated[None, Depends(protect_change)]


def kakao_loader():
    return service.kakao_profile


@router.post("/auth/kakao/start")
def oauth_start(
    payload: OAuthStart, db: DB, response: Response, request: Request, checked: Change
) -> OAuthStartResponse:
    limiter.check(request, "kakao-start", 10)
    return OAuthStartResponse(
        **service.start_oauth(db, payload.store_id, payload.invite_token, response)
    )


@router.get("/auth/kakao/callback", status_code=303, response_class=RedirectResponse)
def oauth_callback(
    db: DB,
    request: Request,
    loader: Annotated[object, Depends(kakao_loader)],
    state: Annotated[str, Query(max_length=100)] = "",
    code: Annotated[str, Query(max_length=2048)] = "",
    error: Annotated[str | None, Query(max_length=200)] = None,
) -> RedirectResponse:
    limiter.check(request, "kakao-callback", 20)
    response = RedirectResponse(
        settings.staff_frontend_url.rstrip("/") + "/staff/attendance", status_code=303
    )
    try:
        if error or not code or not state:
            raise AppError(401, "KAKAO_CANCELLED", "카카오 로그인을 다시 시도해 주세요.")
        store = service.finish_oauth(
            db, request.cookies.get(service.OAUTH_COOKIE, ""), state, code, loader, response
        )
        response.headers["location"] += "?" + urlencode({"store": str(store), "login": "ok"})
    except AppError as exc:
        db.rollback()
        response.headers["location"] += "?" + urlencode({"error": exc.code})
        response.delete_cookie(service.OAUTH_COOKIE, path=f"{settings.api_prefix}/auth/kakao")
    return response


@owner.get("/identities")
def identities(store_id: UUID, db: DB) -> list[IdentityResponse]:
    """PROVISIONAL: 공개 데모의 점주 권한은 아직 검증하지 않는다."""
    return [IdentityResponse(**item) for item in service.list_identities(db, store_id)]


@owner.post("/staff/{staff_id}/invite", status_code=201)
def invite(store_id: UUID, staff_id: UUID, db: DB, checked: Change) -> InviteResponse:
    """PROVISIONAL 점주 API."""
    return InviteResponse(**service.create_invite(db, store_id, staff_id))


@owner.post("/staff/{staff_id}/approve")
def approve(store_id: UUID, staff_id: UUID, db: DB, checked: Change) -> dict[str, bool]:
    """PROVISIONAL 점주 API."""
    return service.approve(db, store_id, staff_id)


@owner.post("/qr")
def qr(store_id: UUID, db: DB, checked: Change) -> QRResponse:
    """PROVISIONAL 점주 API. 매장 QR은 서버에 저장하지 않는다."""
    return QRResponse(**service.issue_qr(db, store_id))


@owner.get("/qr-status")
def qr_status(
    store_id: UUID, since: AwareDatetime, db: DB, staff_id: UUID | None = None
) -> QRStatus:
    """PROVISIONAL 점주 폴링 API."""
    return QRStatus(**service.qr_status(db, store_id, since, staff_id))


@mobile.get("/me")
def me(store_id: UUID, db: DB, request: Request) -> StaffMe:
    limiter.check(request, "staff-me", 120)
    return service.me(db, store_id, request)


@mobile.post("/refresh")
def refresh(
    store_id: UUID, db: DB, request: Request, response: Response, checked: Change
) -> dict[str, bool]:
    return service.rotate(db, store_id, request, response)


@mobile.post("/logout")
def logout(
    store_id: UUID, db: DB, request: Request, response: Response, checked: Change
) -> dict[str, bool]:
    return service.logout(db, store_id, request, response)


@mobile.post("/record")
def record(
    store_id: UUID, payload: QRRecord, db: DB, request: Request, checked: Change
) -> Recorded:
    return service.record_qr(db, store_id, request, payload)
