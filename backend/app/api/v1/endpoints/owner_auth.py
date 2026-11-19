from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.core.staff_security import limiter, protect_owner_change
from app.db.models.owner_auth import OwnerAccount
from app.db.session import get_db
from app.schemas.owner_auth import OwnerMe
from app.schemas.staff_auth import OAuthStartResponse
from app.services import owner_auth as service
from app.services import staff_auth

router = APIRouter(prefix="/auth/owner", tags=["owner-auth"])
type DB = Annotated[Session, Depends(get_db)]
type Change = Annotated[None, Depends(protect_owner_change)]


def kakao_loader():
    return lambda code, verifier: staff_auth.kakao_profile(
        code, verifier, settings.owner_kakao_redirect_uri
    )


def current_owner(db: DB, request: Request) -> OwnerAccount:
    """점주 매장 API에 붙일 의존성. 베타에서는 아직 기존 매장 API에 강제하지 않는다."""
    return service.authenticated(db, request)


@router.get("/kakao/start")
def oauth_start(db: DB, request: Request, response: Response) -> OAuthStartResponse:
    limiter.check(request, "owner-kakao-start", 10)
    return OAuthStartResponse(**service.start_oauth(db, response))


@router.get("/kakao/callback", status_code=303, response_class=RedirectResponse)
def oauth_callback(
    db: DB,
    request: Request,
    loader: Annotated[object, Depends(kakao_loader)],
    state: Annotated[str, Query(max_length=100)] = "",
    code: Annotated[str, Query(max_length=2048)] = "",
    error: Annotated[str | None, Query(max_length=200)] = None,
) -> RedirectResponse:
    limiter.check(request, "owner-kakao-callback", 20)
    base = settings.owner_frontend_url.rstrip("/")
    response = RedirectResponse(base + "/", status_code=303)
    try:
        if error or not code or not state:
            raise AppError(401, "KAKAO_CANCELLED", "카카오 로그인을 다시 시도해 주세요.")
        service.finish_oauth(
            db, request.cookies.get(service.OAUTH_COOKIE, ""), state, code, loader, response
        )
    except AppError as exc:
        db.rollback()
        response = RedirectResponse(
            base + "/login?" + urlencode({"error": exc.code}), status_code=303
        )
        response.delete_cookie(service.OAUTH_COOKIE, path=service.oauth_path())
    return response


@router.get("/me")
def me(db: DB, request: Request) -> OwnerMe:
    limiter.check(request, "owner-me", 120)
    return service.me(db, request)


@router.post("/refresh")
def refresh(db: DB, request: Request, response: Response, checked: Change) -> dict[str, bool]:
    return service.rotate(db, request, response)


@router.post("/logout")
def logout(db: DB, request: Request, response: Response, checked: Change) -> dict[str, bool]:
    return service.logout(db, request, response)
