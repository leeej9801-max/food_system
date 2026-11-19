"""카카오 HTTP를 가짜 의존성으로 대체하는 점주 로그인 경계 검사."""

import logging
import os
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite://")

from test_attendance import migration  # noqa: E402

from app.api.v1.endpoints.owner_auth import kakao_loader  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.staff_security import RedactOAuthAccessLog, limiter  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.models import Store  # noqa: E402
from app.db.models.owner_auth import OwnerOAuthState, OwnerSession, OwnerStore  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services import owner_auth as service  # noqa: E402

ORIGIN = {"Origin": "http://localhost:5174"}
START = "/api/v1/auth/owner/kakao/start"
CALLBACK = "/api/v1/auth/owner/kakao/callback"


@pytest.fixture
def owner_context(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    owner_tables = set(migration("0018_owner_auth.py").TABLES)
    Base.metadata.create_all(
        engine, tables=[t for t in Base.metadata.sorted_tables if t.name not in owner_tables]
    )
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        migration("0018_owner_auth.py").upgrade()
    monkeypatch.setattr(settings, "kakao_rest_api_key", secrets.token_urlsafe(32))
    monkeypatch.setattr(settings, "kakao_client_secret", secrets.token_urlsafe(32))
    monkeypatch.setattr(settings, "owner_auth_signing_key", "")
    monkeypatch.setattr(
        settings,
        "owner_kakao_redirect_uri",
        "http://localhost:8001/api/v1/auth/owner/kakao/callback",
    )
    monkeypatch.setattr(settings, "owner_frontend_url", "http://localhost:5174")
    monkeypatch.setattr(settings, "cors_allowed_origins", "http://localhost:5174")
    monkeypatch.setattr(settings, "app_env", "development")
    clock = [datetime.now(UTC)]
    monkeypatch.setattr(service, "utcnow", lambda: clock[0])
    with Session(engine) as db:
        store = Store(name="QA 매장", timezone="Asia/Seoul")
        db.add(store)
        db.commit()
        store_id = store.id
    app = create_app()

    def database():
        with Session(engine, expire_on_commit=False) as db:
            yield db

    app.dependency_overrides[get_db] = database
    profile = [str(uuid4().int), "QA 점주"]
    app.dependency_overrides[kakao_loader] = lambda: lambda code, verifier: tuple(profile)
    limiter.buckets.clear()
    with TestClient(app) as client:
        yield client, engine, store_id, clock, profile
    engine.dispose()
    limiter.buckets.clear()


def start(client):
    started = client.get(START)
    assert started.status_code == 200
    params = parse_qs(urlsplit(started.json()["authorize_url"]).query)
    assert params["redirect_uri"] == [settings.owner_kakao_redirect_uri]
    assert params["code_challenge_method"] == ["S256"] and params["code_challenge"][0]
    return params["state"][0]


def callback(client, state, **headers):
    return client.get(
        CALLBACK,
        params={"state": state, "code": secrets.token_urlsafe(24)},
        headers=headers,
        follow_redirects=False,
    )


def login(client):
    result = callback(client, start(client))
    assert result.status_code == 303 and result.headers["location"] == "http://localhost:5174/"
    return result


def test_login_sets_cookies_me_and_beta_store_link(owner_context):
    client, engine, store_id, *_ = owner_context
    assert client.get("/api/v1/auth/owner/me").status_code == 401
    result = login(client)
    cookies = result.headers.get_list("set-cookie")
    access = next(c for c in cookies if c.startswith(service.ACCESS_COOKIE + "="))
    refresh = next(c for c in cookies if c.startswith(service.REFRESH_COOKIE + "="))
    assert "HttpOnly" in access and "samesite=lax" in access.lower() and "Max-Age=900" in access
    assert "Path=/api/v1;" in access and "Path=/api/v1/auth/owner;" in refresh
    me = client.get("/api/v1/auth/owner/me")
    assert me.status_code == 200 and me.headers["cache-control"] == "no-store"
    body = me.json()
    assert body["nickname"] == "QA 점주"
    assert body["stores"] == [{"id": str(store_id), "name": "QA 매장"}]
    with Session(engine) as db:
        state = db.scalar(select(OwnerOAuthState))
        assert state is not None and state.used_at is not None
    # 두 번째 점주는 PROVISIONAL 자동 연결 대상이 아니다.
    owner_context[4][0] = str(uuid4().int)
    client.cookies.clear()
    login(client)
    assert client.get("/api/v1/auth/owner/me").json()["stores"] == []
    with Session(engine) as db:
        assert len(list(db.scalars(select(OwnerStore)))) == 1


def test_state_single_use_browser_bound_and_errors(owner_context):
    client = owner_context[0]
    state = start(client)
    oauth = client.cookies.get(service.OAUTH_COOKIE)
    wrong = callback(client, secrets.token_urlsafe(32))
    assert wrong.headers["location"] == "http://localhost:5174/login?error=OAUTH_STATE"
    replay = {"Cookie": f"{service.OAUTH_COOKIE}={oauth}"}
    assert callback(client, state, **replay).headers["location"].endswith(":5174/")
    assert "error=OAUTH_STATE" in callback(client, state, **replay).headers["location"]
    client.cookies.clear()
    other = start(client)
    client.cookies.clear()  # 다른 브라우저에서 콜백을 열면 state 쿠키가 없다.
    assert "error=OAUTH_STATE" in callback(client, other).headers["location"]
    cancelled = client.get(CALLBACK, params={"error": "access_denied"}, follow_redirects=False)
    assert cancelled.headers["location"].endswith("/login?error=KAKAO_CANCELLED")


def test_state_expires(owner_context):
    client, _, _, clock, _ = owner_context
    state = start(client)
    clock[0] += timedelta(minutes=11)
    assert "error=OAUTH_STATE" in callback(client, state).headers["location"]


def test_refresh_rotates_and_reuse_revokes_all_sessions(owner_context):
    client, engine, *_ = owner_context
    login(client)
    first = client.cookies.get(service.REFRESH_COOKIE)
    old_access = client.cookies.get(service.ACCESS_COOKIE)
    assert client.post("/api/v1/auth/owner/refresh").status_code == 403  # Origin 필수
    rotated = client.post("/api/v1/auth/owner/refresh", headers=ORIGIN)
    assert rotated.status_code == 200
    second = client.cookies.get(service.REFRESH_COOKIE)
    assert second and second != first
    reused = client.post(
        "/api/v1/auth/owner/refresh",
        headers={**ORIGIN, "Cookie": f"{service.REFRESH_COOKIE}={first}"},
    )
    assert reused.status_code == 401 and reused.json()["code"] == "REFRESH_REUSED"
    with Session(engine) as db:
        assert all(s.revoked_at is not None for s in db.scalars(select(OwnerSession)))
    me = client.get(
        "/api/v1/auth/owner/me", headers={"Cookie": f"{service.ACCESS_COOKIE}={old_access}"}
    )
    assert me.status_code == 401


def test_session_fixed_expiry_and_logout(owner_context):
    client, _, _, clock, _ = owner_context
    login(client)
    clock[0] += timedelta(days=60)
    assert client.post("/api/v1/auth/owner/refresh", headers=ORIGIN).status_code == 401
    clock[0] -= timedelta(days=60)
    assert client.post("/api/v1/auth/owner/logout").status_code == 403
    assert client.post("/api/v1/auth/owner/logout", headers=ORIGIN).status_code == 200
    assert client.get("/api/v1/auth/owner/me").status_code == 401


def test_access_log_redaction_covers_owner_callback():
    secret = secrets.token_urlsafe(32)
    record = logging.LogRecord(
        "uvicorn.access",
        20,
        "",
        0,
        "%s %s %s %s %s",
        ("client", "GET", CALLBACK + "?code=" + secret, "1.1", 303),
        None,
    )
    RedactOAuthAccessLog().filter(record)
    assert secret not in record.getMessage()
