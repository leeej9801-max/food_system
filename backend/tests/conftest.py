"""공용 fixture. 모든 테스트는 운영과 같은 조건에서 돈다 (ARCH-REVIEW 3.9).

- 스키마는 alembic 마이그레이션으로 만든다 (`create_all` 아님).
- 앱은 런타임 역할 `food_app`(NOBYPASSRLS)로 접속하므로 RLS가 켜져 있다.
- `RLS_TEST_DATABASE_URL`은 **일회용** PostgreSQL의 소유자 URL이어야 한다.
  이 클러스터에 DB `food_api_test`를 만들고 지우며, 역할 `food_app`의 암호를 바꾼다.
"""

import os
import secrets
from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy import make_url

OWNER_URL = os.environ.get("RLS_TEST_DATABASE_URL")
if not OWNER_URL:
    raise pytest.UsageError("RLS_TEST_DATABASE_URL이 없다. 테스트는 일회용 PostgreSQL에서만 돈다")

TEST_DB = "food_api_test"
RUNTIME_ROLE = "food_app"
_PASSWORD = secrets.token_hex(16)
_OWNER_DB_URL = make_url(OWNER_URL).set(database=TEST_DB)

# app.core.config를 import하기 전에 정한다. 앱 엔진(app.db.session)이 이 URL로 접속한다
os.environ["DATABASE_URL"] = _OWNER_DB_URL.set(
    username=RUNTIME_ROLE, password=_PASSWORD
).render_as_string(hide_password=False)
# TestClient는 http라 Secure 쿠키를 돌려보내지 않는다
os.environ.setdefault("GUEST_COOKIE_SECURE", "false")

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import Engine, create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import engine as app_engine  # noqa: E402
from app.main import create_app  # noqa: E402
from scripts.ensure_runtime_role import ensure_runtime_role  # noqa: E402

_BACKEND = Path(__file__).parents[1]


@pytest.fixture(scope="session")
def owner_engine() -> Generator[Engine, None, None]:
    """마이그레이션을 적용한 테스트 DB의 소유자 엔진. RLS를 우회한다."""
    assert OWNER_URL
    admin = create_engine(OWNER_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.exec_driver_sql(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        conn.exec_driver_sql(f"CREATE DATABASE {TEST_DB}")
    owner_url = _OWNER_DB_URL.render_as_string(hide_password=False)

    # alembic env.py는 settings.database_url을 읽으므로 마이그레이션 동안만 바꾼다
    runtime_url = settings.database_url
    settings.database_url = owner_url
    try:
        cfg = Config(str(_BACKEND / "alembic.ini"))
        cfg.set_main_option("script_location", str(_BACKEND / "alembic"))
        command.upgrade(cfg, "head")
    finally:
        settings.database_url = runtime_url
    ensure_runtime_role(owner_url, RUNTIME_ROLE, _PASSWORD)

    owner = create_engine(owner_url)
    yield owner
    owner.dispose()
    app_engine.dispose()
    with admin.connect() as conn:
        conn.exec_driver_sql(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
    admin.dispose()


@pytest.fixture(autouse=True)
def _clean_tables(owner_engine: Engine) -> Generator[None, None, None]:
    yield
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with owner_engine.begin() as conn:
        conn.exec_driver_sql(f"TRUNCATE {tables} CASCADE")


@pytest.fixture
def db_session(owner_engine: Engine) -> Generator[Session, None, None]:
    """테스트가 직접 넣고 확인할 때 쓰는 소유자 세션. 앱 요청은 이 세션을 쓰지 않는다."""
    with Session(owner_engine, autoflush=False, expire_on_commit=False) as session:
        yield session


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    with TestClient(create_app()) as c:
        yield c
