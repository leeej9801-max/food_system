"""ADR-013 B안 적용 확인: 실제 마이그레이션(0006)과 런타임 계정으로 API를 돌려 매장 간 격리를 본다.

PostgreSQL 전용. RLS_TEST_DATABASE_URL(소유자 계정)이 없으면 skip. 일회용 DB rls_api_test를 만들고 지운다.
"""

import os
import secrets
from collections.abc import Generator

import pytest
from alembic.config import Config
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.core.config import settings
from app.db.session import bind_request_scope, get_db
from app.main import create_app
from scripts.ensure_runtime_role import ensure_runtime_role

OWNER_URL = os.environ.get("RLS_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not OWNER_URL, reason="RLS_TEST_DATABASE_URL 미설정 (PostgreSQL 필요)")

TEST_DB = "rls_api_test"
RUNTIME_ROLE = "rls_api_runtime"


@pytest.fixture(scope="module")
def runtime_sessionmaker() -> Generator[sessionmaker, None, None]:
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
        r = client.post("/api/v1/stores", json={"name": f"격리 매장 {key}", "initial_table_count": 2})
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


def test_store_list_is_shared_but_unscoped_db_sees_no_tenant_rows(client, stores, runtime_sessionmaker):
    names = {s["name"] for s in client.get("/api/v1/stores").json()}
    assert {"격리 매장 A", "격리 매장 B"} <= names
    with runtime_sessionmaker() as db:
        assert db.execute(text("SELECT count(*) FROM menu_items")).scalar_one() == 0
        assert db.execute(text("SELECT count(*) FROM recipe_items")).scalar_one() == 0
