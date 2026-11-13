"""ADR-013 B안 적용 확인: 실제 마이그레이션(0006, 0007)과 런타임 계정으로 API를 돌려 매장 간 격리를 본다.

PostgreSQL 전용. RLS_TEST_DATABASE_URL(소유자 계정)이 없으면 skip. 일회용 DB rls_api_test를 만들고 지운다.
"""

import os
import secrets
from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.session import bind_request_scope, get_db
from app.db.tenancy import RequestContext, apply_store_scope
from app.main import create_app
from scripts.ensure_runtime_role import ensure_runtime_role

OWNER_URL = os.environ.get("RLS_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not OWNER_URL, reason="RLS_TEST_DATABASE_URL 미설정 (PostgreSQL 필요)"
)

TEST_DB = "rls_api_test"
RUNTIME_ROLE = "rls_api_runtime"


@pytest.fixture(scope="module")
def runtime_sessionmaker() -> Generator[sessionmaker, None, None]:
    assert OWNER_URL
    admin = create_engine(OWNER_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.exec_driver_sql(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        conn.exec_driver_sql(f"CREATE DATABASE {TEST_DB}")
    owner_url = make_url(OWNER_URL).set(database=TEST_DB).render_as_string(hide_password=False)

    # alembic env.py는 settings.database_url을 읽으므로 마이그레이션 동안만 바꾼다
    original = settings.database_url
    settings.database_url = owner_url
    try:
        cfg = Config(os.path.join(os.path.dirname(__file__), "..", "..", "alembic.ini"))
        cfg.set_main_option(
            "script_location", os.path.join(os.path.dirname(__file__), "..", "..", "alembic")
        )
        command.upgrade(cfg, "head")
    finally:
        settings.database_url = original

    password = secrets.token_hex(16)
    ensure_runtime_role(owner_url, RUNTIME_ROLE, password)
    runtime = create_engine(make_url(owner_url).set(username=RUNTIME_ROLE, password=password))
    yield sessionmaker(bind=runtime, autoflush=False, expire_on_commit=False)
    runtime.dispose()
    with admin.connect() as conn:
        conn.exec_driver_sql(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
    admin.dispose()


@pytest.fixture(scope="module")
def client(runtime_sessionmaker) -> Generator[TestClient, None, None]:
    app = create_app()

    def _get_db(request: Request) -> Generator[Session, None, None]:
        db = runtime_sessionmaker()
        try:
            bind_request_scope(db, request)
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def stores(client) -> dict:
    """두 매장을 API로 만들고 양식당 데모 마스터를 각각 넣는다. 매장 A에만 판매 CSV를 반영한다."""
    out = {}
    for key in ("A", "B"):
        r = client.post(
            "/api/v1/stores", json={"name": f"격리 매장 {key}", "initial_table_count": 2}
        )
        assert r.status_code == 201, r.text
        sid = r.json()["id"]
        assert client.post(f"/api/v1/stores/{sid}/seed-western-demo").status_code == 200
        out[key] = {
            "id": sid,
            "menus": client.get(f"/api/v1/stores/{sid}/menus").json(),
            "ingredients": client.get(f"/api/v1/stores/{sid}/ingredients").json(),
            "tables": client.get(f"/api/v1/stores/{sid}/tables").json(),
        }
    a = out["A"]["id"]
    csv_text = client.get(f"/api/v1/stores/{a}/imports/sales-csv/sample").json()["csv_text"]
    pv = client.post(f"/api/v1/stores/{a}/imports/sales-csv/preview", json={"csv_text": csv_text})
    assert pv.status_code == 200, pv.text
    commit = client.post(f"/api/v1/stores/{a}/imports/sales-csv/{pv.json()['batch_id']}/commit")
    assert commit.status_code == 200, commit.text
    return out


def test_each_store_lists_only_its_own_rows(stores):
    for key in ("A", "B"):
        s = stores[key]
        assert len(s["menus"]) == 4
        assert len(s["ingredients"]) == 5
        assert len(s["tables"]) == 2
        assert {m["store_id"] for m in s["menus"]} == {s["id"]}
    ids_a = {m["id"] for m in stores["A"]["menus"]}
    ids_b = {m["id"] for m in stores["B"]["menus"]}
    assert ids_a.isdisjoint(ids_b)


def test_sales_and_analytics_do_not_leak(client, stores):
    a, b = stores["A"]["id"], stores["B"]["id"]
    sales_a = client.get(f"/api/v1/stores/{a}/analytics/sales").json()
    sales_b = client.get(f"/api/v1/stores/{b}/analytics/sales").json()
    assert sales_a["total_completed_orders"] > 0
    assert sales_b["total_completed_orders"] == 0
    assert client.get(f"/api/v1/stores/{b}/sales-orders").json()["orders"] == []


def test_other_store_menu_is_not_found_through_my_path(client, stores):
    a = stores["A"]["id"]
    b_menu = stores["B"]["menus"][0]["id"]
    assert client.get(f"/api/v1/stores/{a}/menus/{b_menu}").status_code == 404
    r = client.patch(f"/api/v1/stores/{a}/menus/{b_menu}", json={"name": "탈취"})
    assert r.status_code == 404
    assert client.get(f"/api/v1/stores/{a}/menus/{b_menu}/recipe").status_code == 404
    # 매장 B 쪽 데이터는 그대로
    b = stores["B"]["id"]
    assert client.get(f"/api/v1/stores/{b}/menus/{b_menu}").json()["name"] != "탈취"


def test_cannot_write_with_other_store_references(client, stores):
    a = stores["A"]["id"]
    b_ing = stores["B"]["ingredients"][0]["id"]
    b_table = stores["B"]["tables"][0]["id"]
    receipt = client.post(
        f"/api/v1/stores/{a}/inventory/receipts",
        json={"ingredient_id": b_ing, "purchase_quantity": 1, "total_cost": 1000},
    )
    assert receipt.status_code == 404, receipt.text
    visit = client.post(f"/api/v1/stores/{a}/visits", json={"table_id": b_table, "party_size": 2})
    assert visit.status_code == 404, visit.text


def test_own_store_writes_still_work(client, stores):
    a = stores["A"]["id"]
    table = stores["A"]["tables"][0]["id"]
    visit = client.post(f"/api/v1/stores/{a}/visits", json={"table_id": table, "party_size": 3})
    assert visit.status_code == 201, visit.text
    summary = client.get(f"/api/v1/stores/{a}/inventory/summary")
    assert summary.status_code == 200 and len(summary.json()) == 5


def test_store_list_is_shared_but_unscoped_db_sees_no_tenant_rows(
    client, stores, runtime_sessionmaker
):
    names = {s["name"] for s in client.get("/api/v1/stores").json()}
    assert {"격리 매장 A", "격리 매장 B"} <= names
    with runtime_sessionmaker() as db:
        assert db.execute(text("SELECT count(*) FROM menu_items")).scalar_one() == 0
        assert db.execute(text("SELECT count(*) FROM recipe_items")).scalar_one() == 0


# --- 손님 영역 B 1단계 (WO-20261104-003, alembic 0007) ---


@pytest.fixture(scope="module")
def qr(client, stores) -> dict:
    """매장마다 두 번째 테이블에 QR 토큰을 발급한다 (첫 테이블은 위 직원 세션 테스트가 쓴다)."""
    out = {}
    for key in ("A", "B"):
        sid, tid = stores[key]["id"], stores[key]["tables"][1]["id"]
        r = client.post(f"/api/v1/stores/{sid}/tables/{tid}/qr-token")
        assert r.status_code == 200, r.text
        out[key] = {"store_id": sid, "table_id": tid, "token": r.json()["token"]}
    return out


def test_guest_qr_flow_works_under_rls(client, stores, qr):
    a = qr["A"]
    view = client.get(f"/api/guest/v1/qr/{a['token']}")
    assert view.status_code == 200, view.text
    assert view.json()["table_name"] == stores["A"]["tables"][1]["name"]
    opened = client.post(f"/api/guest/v1/qr/{a['token']}/session", json={"party_size": 2})
    assert opened.status_code == 200, opened.text
    assert len(opened.json()["session"]["slots"]) == 2
    claim = client.post(f"/api/guest/v1/qr/{a['token']}/session/slots/1/claim")
    assert claim.status_code == 200 and claim.json()["session"]["slots"][0]["is_mine"]

    visits_a = client.get(f"/api/v1/stores/{a['store_id']}/visits").json()["sessions"]
    assert any(v["opened_by"] == "GUEST_QR" for v in visits_a)
    visits_b = client.get(f"/api/v1/stores/{qr['B']['store_id']}/visits").json()["sessions"]
    assert all(v["opened_by"] != "GUEST_QR" for v in visits_b)
    # 매장 B 토큰은 매장 B 테이블만 본다 (A의 세션이 안 보임)
    assert client.get(f"/api/guest/v1/qr/{qr['B']['token']}").json()["session"] is None


def test_staff_cannot_read_or_rotate_other_store_qr(client, qr):
    a, b = qr["A"], qr["B"]
    base = f"/api/v1/stores/{a['store_id']}/tables/{b['table_id']}/qr-token"
    assert client.get(base).status_code == 404
    assert client.post(base).status_code == 404
    # 매장 B 토큰은 그대로 쓸 수 있다
    assert client.get(f"/api/guest/v1/qr/{b['token']}").status_code == 200


def test_runtime_role_cannot_list_tokens_or_slots(runtime_sessionmaker, qr):
    with runtime_sessionmaker() as db:
        assert db.execute(text("SELECT count(*) FROM table_qr_tokens")).scalar_one() == 0
        assert db.execute(text("SELECT count(*) FROM session_slots")).scalar_one() == 0
        # 함수는 맞는 토큰 1개만 푼다
        rows = db.execute(
            text("SELECT store_id, table_id FROM app_resolve_table_qr(:t)"), {"t": qr["A"]["token"]}
        ).all()
        assert [tuple(map(str, r)) for r in rows] == [(qr["A"]["store_id"], qr["A"]["table_id"])]
        none = db.execute(text("SELECT count(*) FROM app_resolve_table_qr('')")).scalar_one()
        assert none == 0


def test_runtime_role_cannot_insert_slot_for_other_store(runtime_sessionmaker, stores, qr):
    with runtime_sessionmaker() as db:
        apply_store_scope(db, RequestContext(store_id=stores["A"]["id"]))
        visit_id = db.execute(
            text("SELECT id FROM visit_sessions WHERE table_id = :t AND status = 'SEATED'"),
            {"t": qr["A"]["table_id"]},
        ).scalar_one()
        with pytest.raises(ProgrammingError, match="row-level security"):
            db.execute(
                text(
                    "INSERT INTO session_slots (id, store_id, session_id, slot_no, state, "
                    "display_opt_out, created_at, updated_at) VALUES "
                    "(gen_random_uuid(), :b, :v, 9, 'SILHOUETTE', false, now(), now())"
                ),
                {"b": stores["B"]["id"], "v": visit_id},
            )


# --- 홀 배치·객층·맥락·공휴일 (WO-20261105-001, alembic 0008) ---


def test_profile_and_context_work_under_rls(client, qr):
    a = qr["A"]
    base = f"/api/guest/v1/qr/{a['token']}/session"
    client.post(f"{base}/slots/1/claim")
    mine = client.patch(f"{base}/slots/1", json={"gender": "FEMALE", "age_band": "30S"})
    assert mine.status_code == 200
    ctx = client.patch(base, json={"purpose": "GATHERING", "relationship": "FRIENDS"})
    assert ctx.json()["session"]["purpose"] == "GATHERING"

    visits = client.get(f"/api/v1/stores/{a['store_id']}/visits").json()["sessions"]
    visit = next(v for v in visits if v["table_id"] == a["table_id"] and v["status"] == "SEATED")
    assert visit["slots"][0]["profile_source"] == "GUEST"
    staff = client.patch(
        f"/api/v1/stores/{a['store_id']}/visits/{visit['id']}/slots/2", json={"gender": "MALE"}
    )
    assert staff.status_code == 200


def test_staff_cannot_edit_other_store_slot_profile(client, qr):
    a, b = qr["A"], qr["B"]
    visits = client.get(f"/api/v1/stores/{a['store_id']}/visits").json()["sessions"]
    visit_a = next(v for v in visits if v["table_id"] == a["table_id"] and v["status"] == "SEATED")
    # 매장 B 경로로 매장 A 방문의 자리를 고칠 수 없다
    r = client.patch(
        f"/api/v1/stores/{b['store_id']}/visits/{visit_a['id']}/slots/2", json={"age_band": "40S"}
    )
    assert r.status_code == 404


def test_runtime_role_cannot_update_other_store_slot(runtime_sessionmaker, stores):
    with runtime_sessionmaker() as db:
        apply_store_scope(db, RequestContext(store_id=stores["B"]["id"]))
        # 매장 B 범위에서는 매장 A 자리가 보이지 않아 0행이 바뀐다
        changed = db.execute(
            text("UPDATE session_slots SET gender = 'MALE' WHERE store_id = :a"),
            {"a": stores["A"]["id"]},
        ).rowcount
        assert changed == 0


def test_holidays_are_global_for_runtime_role(client, runtime_sessionmaker):
    r = client.post("/api/v1/holidays", json={"holiday_date": "2026-12-25", "name": "기독탄신일"})
    assert r.status_code == 201
    # 매장 범위 없이도 읽힌다 (전역 표, RLS 없음)
    with runtime_sessionmaker() as db:
        assert db.execute(text("SELECT count(*) FROM holidays")).scalar_one() == 1
    assert len(client.get("/api/v1/holidays?year=2026").json()) == 1
