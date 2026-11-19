"""카카오 HTTP를 가짜 의존성으로 대체하는 직원 인증/QR 경계 검사."""

import logging
import os
import secrets
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import jwt
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite://")

from test_attendance import migration  # noqa: E402

from app.api.v1.endpoints.staff_auth import kakao_loader  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.staff_security import RedactOAuthAccessLog, limiter  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.models import (  # noqa: E402
    SalesOrder,
    SalesOrderItem,
    Staff,
    Store,
    StoreTable,
    VisitSession,
)
from app.db.models.staff_auth import (  # noqa: E402
    AttendanceQRSecret,
    StaffInvite,
    StaffRefresh,
    StaffSession,
)
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services import attendance, today_summary  # noqa: E402
from app.services import staff_auth as service

ORIGIN = {"Origin": "http://localhost:5175"}


@pytest.fixture
def auth_context(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    new_tables = set(migration("0014_attendance.py").TABLES) | {
        "audit_logs",
        "attendance_event_retries",
        *migration("0016_staff_kakao_qr.py").TABLES,
    }
    Base.metadata.create_all(
        engine, tables=[t for t in Base.metadata.sorted_tables if t.name not in new_tables]
    )
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        for name in (
            "0014_attendance.py",
            "0015_attendance_integrity.py",
            "0016_staff_kakao_qr.py",
        ):
            migration(name).upgrade()
    monkeypatch.setattr(settings, "kakao_rest_api_key", secrets.token_urlsafe(32))
    monkeypatch.setattr(settings, "kakao_client_secret", secrets.token_urlsafe(32))
    monkeypatch.setattr(settings, "staff_auth_signing_key", secrets.token_urlsafe(48))
    monkeypatch.setattr(
        settings, "kakao_redirect_uri", "http://localhost:8001/api/v1/auth/kakao/callback"
    )
    monkeypatch.setattr(settings, "staff_frontend_url", "http://localhost:5175")
    monkeypatch.setattr(settings, "cors_allowed_origins", "http://localhost:5175")
    monkeypatch.setattr(settings, "app_env", "development")
    clock = [datetime.now(UTC)]
    monkeypatch.setattr(service, "utcnow", lambda: clock[0])
    monkeypatch.setattr(attendance, "utcnow", lambda: clock[0])
    monkeypatch.setattr(today_summary, "utcnow", lambda: clock[0])
    with Session(engine) as db:
        a, b = Store(name="QA A", timezone="Asia/Seoul"), Store(name="QA B", timezone="UTC")
        db.add_all([a, b])
        db.flush()
        person = Staff(store_id=a.id, name="QA 직원", role="HALL", color="#2f6bff")
        db.add(person)
        db.commit()
        store, other, staff_id = a.id, b.id, person.id
    app = create_app()

    def database():
        with Session(engine, expire_on_commit=False) as db:
            yield db

    app.dependency_overrides[get_db] = database
    profile = [str(uuid4().int), "QA 닉네임"]
    app.dependency_overrides[kakao_loader] = lambda: lambda code, verifier: tuple(profile)
    limiter.buckets.clear()
    with TestClient(app) as client:
        yield client, engine, store, other, staff_id, clock, profile, app
    engine.dispose()
    limiter.buckets.clear()


def owner_path(ctx):
    return f"/api/v1/stores/{ctx[2]}/attendance"


def access_path(ctx):
    return f"/api/v1/stores/{ctx[2]}/staff-access"


def invitation(ctx):
    result = ctx[0].post(f"{owner_path(ctx)}/staff/{ctx[4]}/invite", headers=ORIGIN)
    assert result.status_code == 201
    return parse_qs(urlsplit(result.json()["url"]).fragment)["invite"][0]


def login(ctx, invite=None):
    client = ctx[0]
    started = client.post(
        "/api/v1/auth/kakao/start",
        json={"store_id": str(ctx[2]), "invite_token": invite},
        headers=ORIGIN,
    )
    assert started.status_code == 200
    params = parse_qs(urlsplit(started.json()["authorize_url"]).query)
    assert params["scope"] == ["profile_nickname"]
    assert params["code_challenge_method"] == ["S256"] and params["code_challenge"][0]
    result = client.get(
        "/api/v1/auth/kakao/callback",
        params={"state": params["state"][0], "code": secrets.token_urlsafe(24)},
        follow_redirects=False,
    )
    return result, params["state"][0]


def active(ctx):
    result, _ = login(ctx, invitation(ctx))
    assert "login=ok" in result.headers["location"]
    approved = ctx[0].post(f"{owner_path(ctx)}/staff/{ctx[4]}/approve", headers=ORIGIN)
    assert approved.status_code == 200


def qr_token(ctx, *, window=None, store=None):
    response = ctx[0].post(owner_path(ctx) + "/qr", headers=ORIGIN)
    assert response.status_code == 200 and "<svg" in response.json()["svg"]
    with Session(ctx[1]) as db:
        secret = db.get(AttendanceQRSecret, ctx[2])
        assert secret is not None
        window = int(ctx[5][0].timestamp()) // 30 if window is None else window
        return f"{window}.{service.qr_signature(secret.secret, store or ctx[2], window)}"


def record(ctx, token, key=None):
    return ctx[0].post(
        access_path(ctx) + "/record",
        json={"qr_token": token, "client_event_id": str(key or uuid4())},
        headers=ORIGIN,
    )


def test_invite_pending_approval_active_and_cookies(auth_context):
    ctx = auth_context
    raw = invitation(ctx)
    with Session(ctx[1]) as db:
        invitation_row = db.scalar(select(StaffInvite))
        assert invitation_row is not None and invitation_row.token_hash == service.digest(raw)
        assert service.aware(invitation_row.expires_at) == ctx[5][0] + timedelta(days=7)
    response, _ = login(ctx, raw)
    assert "login=ok" in response.headers["location"]
    cookies = response.headers.get_list("set-cookie")
    assert all("HttpOnly" in c and "SameSite=lax" in c for c in cookies[:2])
    assert "Max-Age=900" in cookies[0] and "Max-Age=5184000" in cookies[1]
    assert "Secure" not in cookies[0]
    me = ctx[0].get(access_path(ctx) + "/me")
    assert me.json()["status"] == "PENDING"
    assert record(ctx, qr_token(ctx)).status_code == 403
    assert (
        ctx[0].post(f"{owner_path(ctx)}/staff/{ctx[4]}/approve", headers=ORIGIN).status_code == 200
    )
    assert ctx[0].get(access_path(ctx) + "/me").json()["status"] == "ACTIVE"
    assert (
        ctx[0]
        .post(
            "/api/v1/auth/kakao/start",
            json={"store_id": str(ctx[2]), "invite_token": raw},
            headers=ORIGIN,
        )
        .status_code
        == 410
    )


def test_qr_server_kind_replay_idempotency_polling_and_immutable(auth_context):
    ctx = auth_context
    active(ctx)
    since = ctx[5][0].isoformat()
    token, key = qr_token(ctx), uuid4()
    first = record(ctx, token, key)
    assert first.status_code == 200 and first.json()["kind"] == "IN"
    assert record(ctx, token, key).json() == first.json()
    assert record(ctx, token).json()["code"] == "QR_REUSED"
    status = ctx[0].get(
        owner_path(ctx) + "/qr-status", params={"since": since, "staff_id": str(ctx[4])}
    )
    assert status.json()["completed"]["event_id"] == first.json()["event_id"]
    ctx[5][0] += timedelta(seconds=70)
    assert record(ctx, token, key).json() == first.json()
    second = record(ctx, qr_token(ctx))
    assert second.status_code == 200 and second.json()["kind"] == "OUT"
    with Session(ctx[1]) as db:
        assert db.scalar(text("select count(*) from attendance_events")) == 2
        assert db.scalar(text("select count(*) from attendance_qr_uses")) == 2
    for verb in ("UPDATE attendance_qr_uses SET window=1", "DELETE FROM attendance_qr_uses"):
        with pytest.raises(DatabaseError), ctx[1].begin() as conn:
            conn.execute(text(verb))


@pytest.mark.parametrize("offset,valid", [(0, True), (-1, True), (-2, False), (1, False)])
def test_qr_window_boundary(auth_context, offset, valid):
    ctx = auth_context
    active(ctx)
    window = int(ctx[5][0].timestamp()) // 30 + offset
    result = record(ctx, qr_token(ctx, window=window))
    assert result.status_code == (200 if valid else 410)


def test_qr_wrong_store_signature_and_staff_inactive(auth_context):
    ctx = auth_context
    active(ctx)
    assert record(ctx, "한" * 70).status_code == 422
    assert record(ctx, qr_token(ctx, store=ctx[3])).status_code == 410
    assert ctx[0].get(f"/api/v1/stores/{ctx[3]}/staff-access/me").status_code == 401
    assert ctx[0].delete(f"{owner_path(ctx)}/staff/{ctx[4]}").status_code == 200
    assert record(ctx, qr_token(ctx)).status_code == 401
    with Session(ctx[1]) as db:
        assert all(s.revoked_at is not None for s in db.scalars(select(StaffSession)))


def test_refresh_rotation_fixed_expiry_reuse_revokes_all_sessions(auth_context):
    ctx = auth_context
    active(ctx)
    first_refresh = ctx[0].cookies.get(service.REFRESH_COOKIE)
    old_access = ctx[0].cookies.get(service.ACCESS_COOKIE)
    login(ctx)  # 다른 기기 세션도 만든다.
    absolute_expiry = ctx[5][0] + timedelta(days=60)
    ctx[5][0] += timedelta(days=1)
    assert ctx[0].post(access_path(ctx) + "/refresh", headers=ORIGIN).status_code == 200
    second_refresh = ctx[0].cookies.get(service.REFRESH_COOKIE)
    assert first_refresh != second_refresh
    with Session(ctx[1]) as db:
        sessions = list(db.scalars(select(StaffSession)))
        assert len(sessions) == 2
        assert all(service.aware(s.expires_at) == absolute_expiry for s in sessions)
        hashes = list(db.scalars(select(StaffRefresh.token_hash)))
        assert service.digest(second_refresh) in hashes and second_refresh not in hashes
    assert ctx[0].post(access_path(ctx) + "/refresh", headers=ORIGIN).status_code == 200
    # 회전한 값을 다시 사용하면 모든 기기의 세션을 폐기한다.
    reused = ctx[0].post(
        access_path(ctx) + "/refresh",
        headers={**ORIGIN, "Cookie": f"{service.REFRESH_COOKIE}={second_refresh}"},
    )
    assert reused.status_code == 401 and reused.json()["code"] == "REFRESH_REUSED"
    with Session(ctx[1]) as db:
        assert all(s.revoked_at is not None for s in db.scalars(select(StaffSession)))
    assert (
        ctx[0]
        .get(access_path(ctx) + "/me", headers={"Cookie": f"{service.ACCESS_COOKIE}={old_access}"})
        .status_code
        == 401
    )


def test_refresh_absolute_expiry_and_logout(auth_context):
    ctx = auth_context
    active(ctx)
    ctx[5][0] += timedelta(days=60)
    assert ctx[0].post(access_path(ctx) + "/refresh", headers=ORIGIN).status_code == 401
    ctx[5][0] -= timedelta(days=60)
    assert ctx[0].post(access_path(ctx) + "/logout", headers=ORIGIN).status_code == 200
    assert ctx[0].get(access_path(ctx) + "/me").status_code == 401


def test_oauth_state_browser_binding_one_use_expiry_and_cancel(auth_context):
    ctx = auth_context
    raw = invitation(ctx)
    started = ctx[0].post(
        "/api/v1/auth/kakao/start",
        json={"store_id": str(ctx[2]), "invite_token": raw},
        headers=ORIGIN,
    )
    state = parse_qs(urlsplit(started.json()["authorize_url"]).query)["state"][0]
    cookie = ctx[0].cookies.get(service.OAUTH_COOKIE)
    wrong = ctx[0].get(
        "/api/v1/auth/kakao/callback",
        params={"state": secrets.token_urlsafe(32), "code": secrets.token_urlsafe(24)},
        follow_redirects=False,
    )
    assert "error=OAUTH_STATE" in wrong.headers["location"]

    def callback():
        return ctx[0].get(
            "/api/v1/auth/kakao/callback",
            params={"state": state, "code": secrets.token_urlsafe(24)},
            headers={"Cookie": f"{service.OAUTH_COOKIE}={cookie}"},
            follow_redirects=False,
        )

    assert "login=ok" in callback().headers["location"]
    assert "error=OAUTH_STATE" in callback().headers["location"]
    cancelled = ctx[0].get(
        "/api/v1/auth/kakao/callback", params={"error": "access_denied"}, follow_redirects=False
    )
    assert "error=KAKAO_CANCELLED" in cancelled.headers["location"]


def test_invite_replaced_expired_and_kakao_unique_per_store(auth_context):
    ctx = auth_context
    old, current = invitation(ctx), invitation(ctx)
    assert (
        ctx[0]
        .post(
            "/api/v1/auth/kakao/start",
            json={"store_id": str(ctx[2]), "invite_token": old},
            headers=ORIGIN,
        )
        .status_code
        == 410
    )
    login(ctx, current)
    with Session(ctx[1]) as db:
        p = Staff(store_id=ctx[2], name="QA 둘", role="HALL", color="#2f6bff")
        db.add(p)
        db.commit()
        second = p.id
    response = ctx[0].post(f"{owner_path(ctx)}/staff/{second}/invite", headers=ORIGIN)
    token = parse_qs(urlsplit(response.json()["url"]).fragment)["invite"][0]
    assert "error=STAFF_LINKED" in login(ctx, token)[0].headers["location"]
    ctx[5][0] += timedelta(days=7)
    assert (
        ctx[0]
        .post(
            "/api/v1/auth/kakao/start",
            json={"store_id": str(ctx[2]), "invite_token": token},
            headers=ORIGIN,
        )
        .status_code
        == 410
    )


@pytest.mark.parametrize("origin", [None, "https://untrusted.invalid", "null"])
def test_mutating_origin_required(auth_context, origin):
    ctx = auth_context
    headers = {"Origin": origin} if origin else {}
    assert ctx[0].post(owner_path(ctx) + "/qr", headers=headers).status_code == 403
    assert (
        ctx[0]
        .post("/api/v1/auth/kakao/start", json={"store_id": str(ctx[2])}, headers=headers)
        .status_code
        == 403
    )


def test_rate_limit_and_no_store_logging(auth_context):
    ctx = auth_context
    for _ in range(10):
        assert (
            ctx[0]
            .post("/api/v1/auth/kakao/start", json={"store_id": str(ctx[2])}, headers=ORIGIN)
            .status_code
            == 200
        )
    assert (
        ctx[0]
        .post("/api/v1/auth/kakao/start", json={"store_id": str(ctx[2])}, headers=ORIGIN)
        .status_code
        == 429
    )
    assert ctx[0].get(access_path(ctx) + "/me").headers["cache-control"] == "no-store"
    secret = secrets.token_urlsafe(32)
    record = logging.LogRecord(
        "uvicorn.access",
        20,
        "",
        0,
        "%s %s %s %s %s",
        ("client", "GET", "/api/v1/auth/kakao/callback?code=" + secret, "1.1", 303),
        None,
    )
    RedactOAuthAccessLog().filter(record)
    assert secret not in record.getMessage()


def test_jwt_algorithms_expiry_and_secure_production(auth_context, monkeypatch):
    ctx = auth_context
    active(ctx)
    token = ctx[0].cookies.get(service.ACCESS_COOKIE)
    claims = jwt.decode(
        token,
        service.signing_key(),
        algorithms=["HS256"],
        audience="staff-access",
        issuer=service.ISSUER,
    )
    assert claims["exp"] - claims["iat"] == 900
    forged = jwt.encode(claims, "", algorithm="none")
    assert (
        ctx[0]
        .get(access_path(ctx) + "/me", headers={"Cookie": f"{service.ACCESS_COOKIE}={forged}"})
        .status_code
        == 401
    )
    expired = jwt.encode(
        {**claims, "exp": datetime.now(UTC) - timedelta(seconds=1)},
        service.signing_key(),
        algorithm="HS256",
    )
    assert (
        ctx[0]
        .get(access_path(ctx) + "/me", headers={"Cookie": f"{service.ACCESS_COOKIE}={expired}"})
        .status_code
        == 401
    )
    monkeypatch.setattr(settings, "app_env", "production")
    with pytest.raises(Exception) as exc:
        service.secure_cookie()
    assert getattr(exc.value, "code") == "AUTH_CONFIG"
    monkeypatch.setattr(
        settings, "kakao_redirect_uri", "https://food.leejblab.site/api/v1/auth/kakao/callback"
    )
    monkeypatch.setattr(settings, "staff_frontend_url", "https://food.leejblab.site")
    assert service.secure_cookie()


@pytest.mark.parametrize(
    "tz,start,hours",
    [
        ("Asia/Seoul", datetime(2026, 11, 17, 15, tzinfo=UTC), 24),
        ("America/New_York", datetime(2026, 11, 1, 4, tzinfo=UTC), 25),
    ],
)
def test_today_summary_midnight_timezone_dst_completed_and_isolation(
    auth_context, tz, start, hours
):
    ctx = auth_context
    end = start + timedelta(hours=hours)
    ctx[5][0] = start + timedelta(hours=2)
    with Session(ctx[1]) as db:
        store = db.get(Store, ctx[2])
        assert store is not None
        store.timezone = tz
        table = StoreTable(store_id=ctx[2], name="QA table")
        db.add(table)
        db.flush()
        for at, size in [
            (start - timedelta(microseconds=1), 10),
            (start, 2),
            (end - timedelta(microseconds=1), 3),
            (end, 20),
        ]:
            db.add(
                VisitSession(
                    store_id=ctx[2], table_id=table.id, seated_at=at, party_size=size, status="LEFT"
                )
            )
        for at, status, item_status, price, no_time in [
            (start, "COMPLETED", "COMPLETED", 100, False),
            (end - timedelta(microseconds=1), "COMPLETED", "COMPLETED", 200, True),
            (end, "COMPLETED", "COMPLETED", 400, False),
            (start, "CANCELLED", "COMPLETED", 800, False),
            (start, "COMPLETED", "CANCELLED", 1600, False),
        ]:
            order = SalesOrder(
                store_id=ctx[2],
                external_order_id=uuid4().hex,
                ordered_at=None if no_time else at,
                received_at=at,
                status=status,
            )
            db.add(order)
            db.flush()
            db.add(
                SalesOrderItem(
                    order_id=order.id,
                    store_id=ctx[2],
                    raw_product_name="QA",
                    quantity=1,
                    unit_price=Decimal(price),
                    status=item_status,
                )
            )
        db.commit()
    response = ctx[0].get(f"/api/v1/stores/{ctx[2]}/today-summary")
    assert response.status_code == 200
    assert response.json() == {
        "today_visit_count": 2,
        "today_guest_count": 5,
        "today_net_sales_amount": "300.00",
    }
    assert ctx[0].get(f"/api/v1/stores/{ctx[3]}/today-summary").json()["today_visit_count"] == 0


def test_0016_downgrade_preserves_staff_and_events(auth_context):
    ctx = auth_context
    active(ctx)
    record(ctx, qr_token(ctx))
    with ctx[1].begin() as conn, Operations.context(MigrationContext.configure(conn)):
        migration("0016_staff_kakao_qr.py").downgrade()
        assert conn.scalar(text("select count(*) from attendance_events")) == 1
        assert conn.scalar(text("select count(*) from staff")) == 1
        migration("0016_staff_kakao_qr.py").upgrade()
        assert conn.scalar(text("select count(*) from staff_sessions")) == 0


def test_qr_three_windows_do_not_reuse_old_kind_within_sixty_seconds(auth_context):
    ctx = auth_context
    active(ctx)
    window = int(ctx[5][0].timestamp()) // 30
    ctx[5][0] = datetime.fromtimestamp(window * 30 + 29, UTC)
    assert record(ctx, qr_token(ctx)).json()["kind"] == "IN"
    ctx[5][0] += timedelta(seconds=1)
    assert record(ctx, qr_token(ctx)).json()["kind"] == "OUT"
    ctx[5][0] += timedelta(seconds=30)
    assert record(ctx, qr_token(ctx)).json()["kind"] == "IN"
    with Session(ctx[1]) as db:
        assert db.scalar(text("select count(*) from attendance_events")) == 3


def test_kakao_http_boundary_pkce_and_generic_provider_errors(auth_context, monkeypatch):
    from urllib.parse import parse_qs

    import httpx

    calls = []
    external_access = secrets.token_urlsafe(32)
    code, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(48)

    def handler(request):
        calls.append(request)
        if request.url.host == "kauth.kakao.com":
            return httpx.Response(200, json={"access_token": external_access})
        return httpx.Response(
            200,
            json={"id": int(auth_context[6][0]), "kakao_account": {"profile": {"nickname": "QA"}}},
        )

    constructor = httpx.Client
    monkeypatch.setattr(
        service.httpx,
        "Client",
        lambda **kwargs: constructor(transport=httpx.MockTransport(handler), **kwargs),
    )
    assert service.kakao_profile(code, verifier)[1] == "QA"
    body = parse_qs(calls[0].content.decode())
    assert body["code_verifier"] == [verifier] and body["code"] == [code]
    assert calls[1].headers["authorization"] == f"Bearer {external_access}"
    assert calls[1].url.params["property_keys"] == '["kakao_account.profile.nickname"]'
    monkeypatch.setattr(
        service.httpx,
        "Client",
        lambda **kwargs: constructor(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(400, json={"error": external_access})
            ),
            **kwargs,
        ),
    )
    with pytest.raises(Exception) as exc:
        service.kakao_profile(code, verifier)
    assert external_access not in str(exc.value) and getattr(exc.value, "code") == "KAKAO_LOGIN"


def test_sensitive_failure_is_not_reraised_or_logged(auth_context, caplog):
    ctx = auth_context
    secret = secrets.token_urlsafe(32)

    def failing_provider(code, verifier):
        raise RuntimeError(secret)

    ctx[7].dependency_overrides[kakao_loader] = lambda: failing_provider
    started = ctx[0].post(
        "/api/v1/auth/kakao/start", json={"store_id": str(ctx[2])}, headers=ORIGIN
    )
    state = parse_qs(urlsplit(started.json()["authorize_url"]).query)["state"][0]
    # TestClient 기본 raise_server_exceptions=True에서도 예외/traceback이 경계를 넘지 않는다.
    response = ctx[0].get(
        "/api/v1/auth/kakao/callback", params={"state": state, "code": secrets.token_urlsafe(24)}
    )
    assert response.status_code == 500
    assert response.json()["code"] == "INTERNAL_ERROR"
    assert response.headers["cache-control"] == "no-store"
    assert secret not in response.text + caplog.text
