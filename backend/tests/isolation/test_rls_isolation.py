"""ADR-013 B안 스파이크: PostgreSQL RLS로 매장 간 격리가 실제로 막히는지 확인한다.

PostgreSQL 전용 (RLS는 SQLite에 없음, P-07). 소유자(관리자) 계정 URL을
RLS_TEST_DATABASE_URL 환경변수로 주지 않으면 전체 skip된다.
"""

import os
import secrets
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.db.tenancy import RequestContext, apply_store_scope

OWNER_URL = os.environ.get("RLS_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not OWNER_URL, reason="RLS_TEST_DATABASE_URL 미설정 (PostgreSQL 필요)"
)

RUNTIME_ROLE = "rls_spike_runtime"
STORE_A = uuid.uuid4()
STORE_B = uuid.uuid4()
CHARACTER = uuid.uuid4()


@pytest.fixture(scope="module")
def runtime_engine():
    owner = create_engine(OWNER_URL)
    password = secrets.token_hex(16)
    sql = (Path(__file__).with_name("rls_policies.sql")).read_text(encoding="utf-8")
    with owner.begin() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": RUNTIME_ROLE}
        ).first()
        verb = "ALTER" if exists else "CREATE"
        conn.execute(
            text(f"{verb} ROLE {RUNTIME_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{password}'")
        )
        conn.exec_driver_sql(sql.replace("{runtime_role}", RUNTIME_ROLE))
        _seed(conn)

    url = make_url(OWNER_URL).set(username=RUNTIME_ROLE, password=password)
    # 커넥션 1개만 두어 트랜잭션 사이 범위 누수를 같은 커넥션에서 확인한다
    engine = create_engine(url, pool_size=1, max_overflow=0)
    yield engine
    engine.dispose()
    with owner.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS rls_spike CASCADE"))
    owner.dispose()


def _seed(conn) -> None:
    # 소유자(테스트 컨테이너의 슈퍼유저)는 RLS를 우회하므로 두 매장 데이터를 한 번에 넣을 수 있다
    guest = uuid.uuid4()
    conn.execute(text("INSERT INTO rls_spike.guest_profiles (id) VALUES (:g)"), {"g": guest})
    conn.execute(
        text("INSERT INTO rls_spike.characters (id, guest_profile_id) VALUES (:c, :g)"),
        {"c": CHARACTER, "g": guest},
    )
    for store, names in ((STORE_A, ["A1", "A2"]), (STORE_B, ["B1"])):
        for name in names:
            table_id = uuid.uuid4()
            conn.execute(
                text("INSERT INTO rls_spike.store_tables VALUES (:id, :s, :n)"),
                {"id": table_id, "s": store, "n": name},
            )
            conn.execute(
                text(
                    "INSERT INTO rls_spike.visit_sessions (id, store_id, table_id, party_size, "
                    "character_id) VALUES (:id, :s, :t, 2, :c)"
                ),
                {"id": uuid.uuid4(), "s": store, "t": table_id, "c": CHARACTER},
            )


def _scoped(engine, store) -> Session:
    db = Session(engine)
    apply_store_scope(db, RequestContext(store_id=str(store)))
    return db


def _names(db: Session) -> set[str]:
    return set(db.scalars(text("SELECT name FROM rls_spike.store_tables")))


def test_scoped_read_returns_only_own_store(runtime_engine):
    with _scoped(runtime_engine, STORE_A) as db:
        assert _names(db) == {"A1", "A2"}
        visits = db.execute(text("SELECT count(*) FROM rls_spike.visit_sessions")).scalar_one()
        assert visits == 2


def test_missing_app_filter_is_still_isolated(runtime_engine):
    # 앱 코드가 WHERE store_id 를 빠뜨려도 DB가 막는다 (안전망)
    with _scoped(runtime_engine, STORE_B) as db:
        assert _names(db) == {"B1"}


def test_unscoped_read_returns_nothing(runtime_engine):
    with Session(runtime_engine) as db:
        assert _names(db) == set()


def test_insert_into_other_store_is_rejected(runtime_engine):
    with (
        _scoped(runtime_engine, STORE_A) as db,
        pytest.raises(DBAPIError, match="row-level security"),
    ):
        db.execute(
            text("INSERT INTO rls_spike.store_tables VALUES (:id, :s, 'X')"),
            {"id": uuid.uuid4(), "s": STORE_B},
        )


def test_update_and_delete_other_store_affect_zero_rows(runtime_engine):
    with _scoped(runtime_engine, STORE_A) as db:
        upd = db.execute(
            text("UPDATE rls_spike.store_tables SET name = 'hacked' WHERE store_id = :s"),
            {"s": STORE_B},
        )
        dele = db.execute(
            text("DELETE FROM rls_spike.visit_sessions WHERE store_id = :s"), {"s": STORE_B}
        )
        assert (upd.rowcount, dele.rowcount) == (0, 0)
        db.rollback()


def test_scope_does_not_leak_to_next_transaction(runtime_engine):
    with _scoped(runtime_engine, STORE_A) as db:
        pid_first = db.execute(text("SELECT pg_backend_pid()")).scalar_one()
        assert _names(db) == {"A1", "A2"}
        db.commit()
    with Session(runtime_engine) as db:
        assert db.execute(text("SELECT pg_backend_pid()")).scalar_one() == pid_first
        assert _names(db) == set()


def test_global_tables_need_no_store_scope(runtime_engine):
    with Session(runtime_engine) as db:
        count = db.execute(text("SELECT count(*) FROM rls_spike.characters")).scalar_one()
        assert count == 1


def test_runtime_role_cannot_bypass_rls(runtime_engine):
    with Session(runtime_engine) as db:
        role = db.execute(
            text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
        ).one()
        assert tuple(role) == (False, False)
        owners = set(
            db.scalars(text("SELECT tableowner FROM pg_tables WHERE schemaname = 'rls_spike'"))
        )
        assert RUNTIME_ROLE not in owners
        # row_security 를 끄려 해도 정책 대상 쿼리는 오류가 난다
        db.execute(text("SET row_security = off"))
        with pytest.raises(DBAPIError, match="row-level security"):
            db.execute(text("SELECT name FROM rls_spike.store_tables"))
