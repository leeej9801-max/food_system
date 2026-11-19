"""점주 카카오 로그인 (state + PKCE S256, HttpOnly 쿠키, refresh 회전). 직원 인증 helper를 재사용한다."""

import hashlib
import hmac
import secrets
from datetime import timedelta
from uuid import UUID

import jwt
from fastapi import Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.db.models import utcnow
from app.db.models.owner_auth import (
    OwnerAccount,
    OwnerOAuthState,
    OwnerRefresh,
    OwnerSession,
    OwnerStore,
)
from app.repositories import owner_auth as repo
from app.schemas.owner_auth import OwnerMe
from app.services.staff_auth import authorize_url, aware, digest
from app.services.staff_auth import secure_cookie as staff_secure_cookie

ACCESS_COOKIE = "food_owner_access"
REFRESH_COOKIE = "food_owner_refresh"
OAUTH_COOKIE = "food_owner_oauth"
ISSUER = "food-owner"


def oauth_path() -> str:
    return f"{settings.api_prefix}/auth/owner/kakao"


def refresh_path() -> str:
    return f"{settings.api_prefix}/auth/owner"


def unauthorized(code="OWNER_SESSION") -> AppError:
    return AppError(401, code, "카카오 로그인 후 다시 시도해 주세요.")


def signing_key() -> str:
    if settings.owner_auth_signing_key:
        if len(settings.owner_auth_signing_key.encode()) < 32:
            raise AppError(503, "AUTH_CONFIG", "점주 인증 설정을 확인해 주세요.")
        return settings.owner_auth_signing_key
    if not settings.kakao_client_secret:
        raise AppError(503, "AUTH_CONFIG", "점주 인증 설정을 확인해 주세요.")
    return hmac.new(
        settings.kakao_client_secret.encode(), b"food/owner-jwt/v1", hashlib.sha256
    ).hexdigest()


def secure_cookie() -> bool:
    return staff_secure_cookie(settings.owner_kakao_redirect_uri, settings.owner_frontend_url)


def encode(payload: dict, purpose: str, expires) -> str:
    return jwt.encode(
        {**payload, "iss": ISSUER, "aud": purpose, "iat": utcnow(), "exp": expires},
        signing_key(),
        algorithm="HS256",
    )


def decode(token: str, purpose: str) -> dict:
    try:
        return jwt.decode(
            token,
            signing_key(),
            algorithms=["HS256"],
            issuer=ISSUER,
            audience=purpose,
            options={"require": ["exp", "iat", "iss", "aud"]},
        )
    except jwt.InvalidTokenError:
        raise unauthorized() from None


def cookie(response: Response, name: str, value: str, max_age: int, path: str):
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        path=path,
        httponly=True,
        secure=secure_cookie(),
        samesite="lax",
    )


def set_session_cookies(response: Response, session: OwnerSession, refresh_token: str):
    now = utcnow()
    remaining = max(0, int((aware(session.expires_at) - now).total_seconds()))
    access_seconds = min(900, remaining)
    access = encode(
        {"sub": str(session.owner_id), "sid": str(session.id)},
        "owner-access",
        now + timedelta(seconds=access_seconds),
    )
    # access는 이후 점주 매장 API에서도 쓰도록 API 전체, refresh는 인증 경로에만 보낸다.
    cookie(response, ACCESS_COOKIE, access, access_seconds, settings.api_prefix)
    cookie(response, REFRESH_COOKIE, refresh_token, remaining, refresh_path())


def clear_cookies(response: Response):
    for name, path in ((ACCESS_COOKIE, settings.api_prefix), (REFRESH_COOKIE, refresh_path())):
        response.delete_cookie(
            name, path=path, httponly=True, secure=secure_cookie(), samesite="lax"
        )


def new_refresh(db: Session, session: OwnerSession) -> str:
    token = secrets.token_urlsafe(48)
    repo.add(db, OwnerRefresh(session_id=session.id, token_hash=digest(token)))
    return token


def start_oauth(db: Session, response: Response) -> dict:
    if not settings.kakao_rest_api_key or not settings.kakao_client_secret:
        raise AppError(503, "AUTH_CONFIG", "점주 카카오 로그인 설정을 확인해 주세요.")
    secure = secure_cookie()
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    expires = utcnow() + timedelta(minutes=10)
    repo.add(db, OwnerOAuthState(state_hash=digest(state), verifier=verifier, expires_at=expires))
    # state를 요청한 브라우저에 묶는다 (login CSRF 차단).
    response.set_cookie(
        OAUTH_COOKIE,
        encode({"state_hash": digest(state)}, "owner-oauth", expires),
        max_age=600,
        path=oauth_path(),
        httponly=True,
        secure=secure,
        samesite="lax",
    )
    db.commit()
    return {"authorize_url": authorize_url(state, verifier, settings.owner_kakao_redirect_uri)}


def finish_oauth(
    db: Session, cookie_value: str, state: str, code: str, profile_loader, response: Response
) -> None:
    try:
        payload = decode(cookie_value, "owner-oauth")
    except AppError:
        payload = {}
    if not hmac.compare_digest(str(payload.get("state_hash", "")), digest(state)):
        raise AppError(401, "OAUTH_STATE", "로그인 요청이 일치하지 않습니다.")
    nonce = repo.oauth_state(db, digest(state))
    if nonce is None or nonce.used_at or aware(nonce.expires_at) <= utcnow():
        raise AppError(401, "OAUTH_STATE", "로그인 요청이 만료되었거나 이미 사용되었습니다.")
    nonce.used_at = utcnow()
    verifier = nonce.verifier
    db.commit()  # 외부 HTTP 호출 전에 state 재사용을 차단한다.
    kakao_id, nickname = profile_loader(code, verifier)
    now = utcnow()
    try:
        owner = repo.owner(db, kakao_id=kakao_id)
        if owner is None:
            owner = OwnerAccount(kakao_id=kakao_id)
            repo.add(db, owner)
        owner.nickname, owner.last_login_at = nickname, now
        # PROVISIONAL(베타): 아직 아무 점주도 연결되지 않았고 매장이 정확히 1개면 첫 로그인 점주에게
        # 연결한다. 점주 초대/매장 등록 흐름이 생기면 제거한다.
        store = None if repo.any_link(db) else repo.only_store(db)
        if store is not None:
            repo.add(db, OwnerStore(owner_id=owner.id, store_id=store.id))
        session = OwnerSession(owner_id=owner.id, expires_at=now + timedelta(days=60))
        repo.add(db, session)
        token = new_refresh(db, session)
        db.commit()
    except IntegrityError:
        # 같은 계정·매장의 동시 첫 로그인. 다시 시도하면 기존 행을 사용한다.
        db.rollback()
        raise AppError(409, "OWNER_LOGIN_RETRY", "로그인을 다시 시도해 주세요.") from None
    set_session_cookies(response, session, token)
    response.delete_cookie(OAUTH_COOKIE, path=oauth_path())


def authenticated(db: Session, request: Request) -> OwnerAccount:
    claims = decode(request.cookies.get(ACCESS_COOKIE, ""), "owner-access")
    try:
        session = repo.session(db, UUID(claims["sid"]))
    except (ValueError, KeyError, TypeError):
        session = None
    if (
        session is None
        or session.revoked_at
        or aware(session.expires_at) <= utcnow()
        or str(session.owner_id) != claims.get("sub")
    ):
        raise unauthorized()
    owner = repo.owner(db, owner_id=session.owner_id)
    if owner is None:
        raise unauthorized()
    return owner


def me(db: Session, request: Request) -> OwnerMe:
    owner = authenticated(db, request)
    return OwnerMe.model_validate(
        {
            "owner_id": owner.id,
            "nickname": owner.nickname,
            "stores": [{"id": s.id, "name": s.name} for s in repo.stores(db, owner.id)],
        }
    )


def rotate(db: Session, request: Request, response: Response) -> dict[str, bool]:
    credential = repo.refresh(db, digest(request.cookies.get(REFRESH_COOKIE, "")), lock=True)
    session = repo.session(db, credential.session_id) if credential else None
    if credential is None or session is None:
        raise unauthorized()
    now = utcnow()
    if credential.used_at:
        repo.revoke_owner(db, session.owner_id, now)
        db.commit()
        raise AppError(401, "REFRESH_REUSED", "세션 재사용이 감지되어 모든 세션을 종료했습니다.")
    if session.revoked_at or aware(session.expires_at) <= now:
        raise unauthorized()
    credential.used_at = now
    token = new_refresh(db, session)
    db.commit()
    set_session_cookies(response, session, token)
    return {"refreshed": True}


def logout(db: Session, request: Request, response: Response) -> dict[str, bool]:
    credential = repo.refresh(db, digest(request.cookies.get(REFRESH_COOKIE, "")))
    session = repo.session(db, credential.session_id) if credential else None
    if session:
        session.revoked_at = utcnow()
        db.commit()
    clear_cookies(response)
    return {"logged_out": True}
