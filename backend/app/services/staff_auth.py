import base64
import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime, timedelta
from io import BytesIO
from urllib.parse import urlencode, urlsplit
from uuid import UUID

import httpx
import jwt
import qrcode
import qrcode.constants
import qrcode.image.svg
from fastapi import Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.db.models import utcnow
from app.db.models.staff_auth import (
    AttendanceQRSecret,
    AttendanceQRUse,
    StaffIdentity,
    StaffInvite,
    StaffOAuthState,
    StaffRefresh,
    StaffSession,
)
from app.db.tenancy import RequestContext, bind_store_scope
from app.repositories import attendance as attendance_repo
from app.repositories import staff_auth as repo
from app.schemas.attendance import EventCreate
from app.schemas.staff_auth import Recorded, StaffMe
from app.services import attendance
from app.services.menus import get_store_or_404

ACCESS_COOKIE = "food_staff_access"
REFRESH_COOKIE = "food_staff_refresh"
OAUTH_COOKIE = "food_staff_oauth"
ISSUER = "food-staff"

logger = logging.getLogger(__name__)


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def signing_key() -> str:
    if settings.staff_auth_signing_key:
        if len(settings.staff_auth_signing_key.encode()) < 32:
            raise AppError(503, "AUTH_CONFIG", "직원 인증 설정을 확인해 주세요.")
        return settings.staff_auth_signing_key
    if not settings.kakao_client_secret:
        raise AppError(503, "AUTH_CONFIG", "직원 인증 설정을 확인해 주세요.")
    return hmac.new(
        settings.kakao_client_secret.encode(), b"food/staff-jwt/v1", hashlib.sha256
    ).hexdigest()


def secure_cookie(*configured: str) -> bool:
    configured = configured or (settings.kakao_redirect_uri, settings.staff_frontend_url)
    urls = [urlsplit(url) for url in configured]
    local = all(
        u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1", "::1") for u in urls
    )
    if settings.app_env != "production" and local:
        return False
    if any(u.scheme != "https" for u in urls):
        raise AppError(503, "AUTH_CONFIG", "직원 인증 HTTPS 설정을 확인해 주세요.")
    return True


def scope(db: Session, store_id: UUID, actor="staff-auth"):
    bind_store_scope(db, RequestContext(store_id=store_id, actor=actor))


def staff(db: Session, store_id: UUID, staff_id: UUID):
    row = attendance_repo.get_staff(db, store_id, staff_id)
    if row is None or row.status != "ACTIVE":
        raise AppError(403, "STAFF_INACTIVE", "매장에 등록된 활성 직원만 이용할 수 있습니다.")
    return row


def encode(payload: dict, purpose: str, expires: datetime) -> str:
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
        raise AppError(401, "STAFF_SESSION", "카카오 로그인 후 다시 시도해 주세요.") from None


def cookie_path(store_id: UUID) -> str:
    return f"{settings.api_prefix}/stores/{store_id}/staff-access"


def set_session_cookies(response: Response, session: StaffSession, refresh_token: str):
    now = utcnow()
    remaining = max(0, int((aware(session.expires_at) - now).total_seconds()))
    access_seconds = min(900, remaining)
    response.set_cookie(
        ACCESS_COOKIE,
        encode(
            {"sub": str(session.staff_id), "sid": str(session.id), "store": str(session.store_id)},
            "staff-access",
            now + timedelta(seconds=access_seconds),
        ),
        max_age=access_seconds,
        path=cookie_path(session.store_id),
        httponly=True,
        secure=secure_cookie(),
        samesite="lax",
    )
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=remaining,
        path=cookie_path(session.store_id),
        httponly=True,
        secure=secure_cookie(),
        samesite="lax",
    )


def clear_cookies(response: Response, store_id: UUID):
    for name in (ACCESS_COOKIE, REFRESH_COOKIE):
        response.delete_cookie(
            name, path=cookie_path(store_id), httponly=True, secure=secure_cookie(), samesite="lax"
        )


def new_refresh(db: Session, session: StaffSession) -> str:
    token = secrets.token_urlsafe(48)
    repo.add(
        db, StaffRefresh(store_id=session.store_id, session_id=session.id, token_hash=digest(token))
    )
    return token


def create_invite(db: Session, store_id: UUID, staff_id: UUID):
    scope(db, store_id)
    person = staff(db, store_id, staff_id)
    if repo.identity(db, store_id, staff_id=person.id):
        raise AppError(409, "STAFF_LINKED", "이미 카카오 계정이 연결된 직원입니다.")
    now, token = utcnow(), secrets.token_urlsafe(48)
    expires = now + timedelta(days=7)
    repo.invalidate_invites(db, store_id, staff_id, now)
    repo.add(
        db,
        StaffInvite(
            store_id=store_id, staff_id=staff_id, token_hash=digest(token), expires_at=expires
        ),
    )
    db.commit()
    fragment = urlencode({"store": str(store_id), "invite": token})
    return {
        "url": settings.staff_frontend_url.rstrip("/") + "/staff/invite#" + fragment,
        "expires_at": expires,
        "provisional": True,
    }


def list_identities(db: Session, store_id: UUID):
    scope(db, store_id)
    get_store_or_404(db, store_id)
    return [
        {
            "staff_id": person.id,
            "name": person.name,
            "nickname": link.nickname if link else None,
            "status": link.status if link else "UNLINKED",
            "provisional": True,
        }
        for person, link in repo.identities(db, store_id)
    ]


def approve(db: Session, store_id: UUID, staff_id: UUID):
    scope(db, store_id)
    staff(db, store_id, staff_id)
    link = repo.identity(db, store_id, staff_id=staff_id)
    if link is None:
        raise AppError(409, "STAFF_NOT_LINKED", "직원이 초대 링크에서 먼저 로그인해야 합니다.")
    link.status = "ACTIVE"
    db.commit()
    return {"approved": True, "provisional": True}


def start_oauth(db: Session, store_id: UUID, invite_token: str | None, response: Response):
    scope(db, store_id)
    get_store_or_404(db, store_id)
    if not settings.kakao_rest_api_key or not settings.kakao_client_secret:
        raise AppError(503, "AUTH_CONFIG", "직원 카카오 로그인 설정을 확인해 주세요.")
    secure = secure_cookie()
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    expires = utcnow() + timedelta(minutes=10)
    invite_hash = digest(invite_token) if invite_token else None
    if invite_hash:
        invitation = repo.invite(db, store_id, invite_hash)
        if invitation is None or invitation.used_at or aware(invitation.expires_at) <= utcnow():
            raise AppError(410, "INVITE_EXPIRED", "초대 링크가 만료되었거나 이미 사용되었습니다.")
    repo.add(db, StaffOAuthState(store_id=store_id, state_hash=digest(state), expires_at=expires))
    response.set_cookie(
        OAUTH_COOKIE,
        encode(
            {
                "state_hash": digest(state),
                "verifier": verifier,
                "store": str(store_id),
                "invite_hash": invite_hash,
            },
            "staff-oauth",
            expires,
        ),
        max_age=600,
        path=f"{settings.api_prefix}/auth/kakao",
        httponly=True,
        secure=secure,
        samesite="lax",
    )
    db.commit()
    return {"authorize_url": authorize_url(state, verifier, settings.kakao_redirect_uri)}


def authorize_url(state: str, verifier: str, redirect_uri: str) -> str:
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    return "https://kauth.kakao.com/oauth/authorize?" + urlencode(
        {
            "response_type": "code",
            "client_id": settings.kakao_rest_api_key,
            "redirect_uri": redirect_uri,
            "scope": "profile_nickname",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )


def kakao_profile(code: str, verifier: str, redirect_uri: str | None = None) -> tuple[str, str]:
    """HTTP 경계: 테스트는 이 함수 의존성을 교체한다. 카카오 토큰은 영속화하지 않는다."""
    try:
        with httpx.Client(timeout=10, follow_redirects=False) as client:
            token = client.post(
                "https://kauth.kakao.com/oauth/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": settings.kakao_rest_api_key,
                    "client_secret": settings.kakao_client_secret,
                    "redirect_uri": redirect_uri or settings.kakao_redirect_uri,
                    "code": code,
                    "code_verifier": verifier,
                },
            )
            token.raise_for_status()
            access = token.json()["access_token"]
            info = client.get(
                "https://kapi.kakao.com/v2/user/me",
                headers={"Authorization": f"Bearer {access}"},
                params={"property_keys": '["kakao_account.profile.nickname"]'},
            )
            info.raise_for_status()
            data = info.json()
            kakao_id = str(data["id"])
            nickname = data.get("kakao_account", {}).get("profile", {}).get("nickname", "")
            if not kakao_id.isdecimal() or not isinstance(nickname, str) or not nickname.strip():
                raise ValueError("invalid profile")
            return kakao_id, nickname[:100]
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        # 비밀값 없이 카카오 오류 코드(KOExxx)와 단계만 남긴다.
        body = getattr(getattr(exc, "response", None), "text", "")[:300]
        code_hint = body.split('"error_code":"')[1][:6] if '"error_code":"' in body else ""
        logger.warning(
            "kakao login failed: %s %s %s", type(exc).__name__, code_hint, exc.__class__.__module__
        )
        raise AppError(
            502, "KAKAO_LOGIN", "카카오 로그인에 실패했습니다. 다시 시도해 주세요."
        ) from None


def finish_oauth(
    db: Session, cookie: str, state: str, code: str, profile_loader, response: Response
):
    payload = decode(cookie, "staff-oauth")
    if not hmac.compare_digest(payload["state_hash"], digest(state)):
        raise AppError(401, "OAUTH_STATE", "로그인 요청이 일치하지 않습니다.")
    store_id = UUID(payload["store"])
    scope(db, store_id)
    nonce = repo.oauth_state(db, store_id, digest(state))
    if nonce is None or nonce.used_at or aware(nonce.expires_at) <= utcnow():
        raise AppError(401, "OAUTH_STATE", "로그인 요청이 만료되었거나 이미 사용되었습니다.")
    nonce.used_at = utcnow()
    db.commit()  # 외부 HTTP 호출 전에 state의 재사용을 차단한다.
    kakao_id, nickname = profile_loader(code, payload["verifier"])
    repo.lock_store(db, store_id)  # 매장당 계정·직원 연결을 직렬화한다.
    link = repo.identity(db, store_id, kakao_id=kakao_id)
    if payload.get("invite_hash"):
        invitation = repo.invite(db, store_id, payload["invite_hash"])
        if invitation is None or invitation.used_at or aware(invitation.expires_at) <= utcnow():
            raise AppError(410, "INVITE_EXPIRED", "초대 링크가 만료되었거나 이미 사용되었습니다.")
        staff(db, store_id, invitation.staff_id)
        if link or repo.identity(db, store_id, staff_id=invitation.staff_id):
            raise AppError(409, "STAFF_LINKED", "이 계정 또는 직원은 이미 연결되어 있습니다.")
        link = StaffIdentity(
            store_id=store_id,
            staff_id=invitation.staff_id,
            kakao_id=kakao_id,
            nickname=nickname,
            status="PENDING",
        )
        repo.add(db, link)
        invitation.used_at = utcnow()
    if link is None:
        raise AppError(403, "STAFF_NOT_LINKED", "점주에게 직원 초대 링크를 요청해 주세요.")
    staff(db, store_id, link.staff_id)
    session = StaffSession(
        store_id=store_id, staff_id=link.staff_id, expires_at=utcnow() + timedelta(days=60)
    )
    repo.add(db, session)
    token = new_refresh(db, session)
    db.commit()
    set_session_cookies(response, session, token)
    response.delete_cookie(OAUTH_COOKIE, path=f"{settings.api_prefix}/auth/kakao")
    return store_id


def authenticated(db: Session, store_id: UUID, request: Request):
    claims = decode(request.cookies.get(ACCESS_COOKIE, ""), "staff-access")
    if claims.get("store") != str(store_id):
        raise AppError(401, "STAFF_SESSION", "해당 매장에 다시 로그인해 주세요.")
    scope(db, store_id, "staff:" + str(claims.get("sub", "")))
    try:
        session = repo.session(db, store_id, UUID(claims["sid"]))
    except (ValueError, KeyError, TypeError):
        session = None
    if (
        session is None
        or session.revoked_at
        or aware(session.expires_at) <= utcnow()
        or str(session.staff_id) != claims.get("sub")
    ):
        raise AppError(401, "STAFF_SESSION", "카카오 로그인 후 다시 시도해 주세요.")
    person = staff(db, store_id, session.staff_id)
    link = repo.identity(db, store_id, staff_id=person.id)
    if link is None:
        raise AppError(403, "STAFF_NOT_LINKED", "연결된 직원 계정이 없습니다.")
    return person, link, session


def me(db: Session, store_id: UUID, request: Request) -> StaffMe:
    person, link, _ = authenticated(db, store_id, request)
    return StaffMe.model_validate(
        {"staff_id": person.id, "name": person.name, "status": link.status}
    )


def rotate(db: Session, store_id: UUID, request: Request, response: Response):
    scope(db, store_id)
    hashed = digest(request.cookies.get(REFRESH_COOKIE, ""))
    credential = repo.refresh(db, store_id, hashed)
    session = repo.session(db, store_id, credential.session_id) if credential else None
    if credential is None or session is None:
        raise AppError(401, "STAFF_SESSION", "다시 로그인해 주세요.")
    staff(db, store_id, session.staff_id)  # 동시 rotation/기록의 잠금 순서를 통일한다.
    credential = repo.refresh(db, store_id, hashed, lock=True)
    assert credential is not None
    session = repo.session(db, store_id, session.id)
    assert session is not None
    now = utcnow()
    if credential.used_at:
        repo.revoke_staff(db, store_id, session.staff_id, now)
        db.commit()
        raise AppError(
            401, "REFRESH_REUSED", "세션 재사용이 감지되어 모든 직원 세션을 종료했습니다."
        )
    if session.revoked_at or aware(session.expires_at) <= now:
        raise AppError(401, "STAFF_SESSION", "다시 로그인해 주세요.")
    credential.used_at = now
    token = new_refresh(db, session)
    db.commit()
    set_session_cookies(response, session, token)
    return {"refreshed": True}


def logout(db: Session, store_id: UUID, request: Request, response: Response):
    scope(db, store_id)
    credential = repo.refresh(db, store_id, digest(request.cookies.get(REFRESH_COOKIE, "")))
    session = repo.session(db, store_id, credential.session_id) if credential else None
    if session:
        attendance_repo.get_staff(db, store_id, session.staff_id)
        session.revoked_at = utcnow()
        db.commit()
    clear_cookies(response, store_id)
    return {"logged_out": True}


def qr_signature(secret: str, store_id: UUID, window: int) -> str:
    return hmac.new(
        bytes.fromhex(secret), f"{store_id}:{window}".encode(), hashlib.sha256
    ).hexdigest()


def issue_qr(db: Session, store_id: UUID):
    scope(db, store_id)
    if repo.lock_store(db, store_id) is None:
        raise AppError(404, "STORE_NOT_FOUND", "매장을 찾을 수 없습니다.")
    secret = repo.qr_secret(db, store_id)
    if secret is None:
        secret = AttendanceQRSecret(store_id=store_id, secret=secrets.token_hex(32))
        repo.add(db, secret)
    now = utcnow()
    window = int(now.timestamp()) // 30
    token = f"{window}.{qr_signature(secret.secret, store_id, window)}"
    url = (
        settings.staff_frontend_url.rstrip("/")
        + "/staff/attendance#"
        + urlencode({"store": str(store_id), "qr": token})
    )
    qr = qrcode.QRCode(box_size=6, border=4, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(url)
    qr.make(fit=True)
    buffer = BytesIO()
    qr.make_image(image_factory=qrcode.image.svg.SvgPathImage).save(buffer)
    db.commit()
    return {
        "svg": buffer.getvalue().decode(),
        "server_now": now,
        "expires_at": datetime.fromtimestamp((window + 1) * 30, UTC),
        "provisional": True,
    }


def record_qr(db: Session, store_id: UUID, request: Request, payload):
    person, link, _ = authenticated(db, store_id, request)
    if link.status != "ACTIVE":
        raise AppError(403, "STAFF_PENDING", "점주 승인 후 출퇴근을 등록할 수 있습니다.")
    existing = attendance_repo.get_event_by_client_id(
        db, store_id, person.id, payload.client_event_id
    )
    if existing is not None:
        return Recorded.model_validate(
            {
                "event_id": existing.id,
                "name": person.name,
                "kind": existing.kind,
                "occurred_at": existing.occurred_at,
            }
        )
    now = utcnow()
    try:
        raw_window, signature = payload.qr_token.split(".", 1)
        window = int(raw_window)
    except (ValueError, TypeError):
        raise AppError(400, "QR_INVALID", "매장의 QR을 다시 스캔해 주세요.") from None
    current = int(now.timestamp()) // 30
    secret = repo.qr_secret(db, store_id)
    if (
        window not in (current, current - 1)
        or secret is None
        or not hmac.compare_digest(signature, qr_signature(secret.secret, store_id, window))
    ):
        raise AppError(
            410, "QR_EXPIRED", "QR이 만료되었거나 유효하지 않습니다. 매장 QR을 다시 스캔해 주세요."
        )
    if repo.qr_use(db, store_id, person.id, window):
        raise AppError(409, "QR_REUSED", "이 QR로 이미 등록했습니다. 다음 QR을 이용해 주세요.")
    rows = [
        r
        for r in attendance.effective_events(
            attendance_repo.list_events(db, store_id),
            attendance_repo.list_corrections(db, store_id),
        )
        if r["staff_id"] == person.id
    ]
    kind = "OUT" if rows and rows[-1]["kind"] == "IN" else "IN"
    try:
        event, _ = attendance.record_event(
            db,
            store_id,
            EventCreate(staff_id=person.id, kind=kind, client_event_id=payload.client_event_id),
            commit=False,
            # QR 자체의 직원/창 재사용 차단을 사용하여 IN→OUT→IN을 과거 IN으로 합치지 않는다.
            deduplicate_recent=False,
        )
        repo.add(
            db,
            AttendanceQRUse(
                store_id=store_id, staff_id=person.id, window=window, event_id=event.id
            ),
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "QR_REUSED", "이미 처리된 QR입니다. 기록을 확인해 주세요.") from None
    return Recorded.model_validate(
        {
            "event_id": event.id,
            "name": person.name,
            "kind": event.kind,
            "occurred_at": event.occurred_at,
        }
    )


def qr_status(db: Session, store_id: UUID, since: datetime, staff_id: UUID | None):
    scope(db, store_id)
    get_store_or_404(db, store_id)
    row = repo.qr_completion(db, store_id, since, staff_id)
    result = (
        Recorded.model_validate(
            {
                "event_id": row[0].id,
                "name": row[1],
                "kind": row[0].kind,
                "occurred_at": row[0].occurred_at,
            }
        )
        if row
        else None
    )
    return {"completed": result, "provisional": True}
