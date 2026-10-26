import json
from collections.abc import Generator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.models import AuditEvent
from app.db.session import get_db
from app.main import create_app


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    app = create_app()

    def _override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c


def _create_store(client: TestClient, name: str = "1인 식당 파일럿") -> dict:
    resp = client.post("/api/v1/stores", json={"name": name})
    assert resp.status_code == 201
    return resp.json()


def test_ac1_store_create_and_list(client: TestClient) -> None:
    store = _create_store(client, "소담 분식")
    assert store["name"] == "소담 분식"
    assert store["timezone"] == "Asia/Seoul"

    listed = client.get("/api/v1/stores").json()
    assert len(listed) == 1
    assert listed[0]["id"] == store["id"]


def test_ac2_ac3_menu_create_list_filter_and_patch(client: TestClient) -> None:
    store = _create_store(client)
    store_id = store["id"]

    created = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={
            "name": "  제육볶음  ",
            "selling_price": "12000",
            "category": "식사",
            "description": "대표 메뉴",
        },
    )
    assert created.status_code == 201
    menu = created.json()
    assert menu["name"] == "제육볶음"
    assert Decimal(str(menu["selling_price"])) == Decimal("12000.00")
    assert menu["is_active"] is True
    assert menu["pos_mapping_status"] == "UNLINKED_PROVISIONAL"
    assert menu["recipe_status"] == "UNREGISTERED"

    # 두 번째 메뉴 (선택값 비움 허용 확인)
    second = client.post(f"/api/v1/stores/{store_id}/menus", json={"name": "김치찌개"})
    assert second.status_code == 201
    assert second.json()["selling_price"] is None

    # 검색 필터
    filtered = client.get(f"/api/v1/stores/{store_id}/menus", params={"q": "제육"}).json()
    assert len(filtered) == 1
    assert filtered[0]["name"] == "제육볶음"

    # PATCH 부분 수정 (가격만 변경)
    patched = client.patch(
        f"/api/v1/stores/{store_id}/menus/{menu['id']}",
        json={"selling_price": "13000"},
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["name"] == "제육볶음"
    assert Decimal(str(body["selling_price"])) == Decimal("13000.00")
    assert body["category"] == "식사"


def test_ac4_menu_deactivate_preserves_record_and_allows_reactivation(client: TestClient) -> None:
    store = _create_store(client)
    store_id = store["id"]
    menu = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "계절냉면", "selling_price": 9000},
    ).json()

    # 비활성화
    deactivated = client.patch(
        f"/api/v1/stores/{store_id}/menus/{menu['id']}",
        json={"is_active": False},
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    # 물리 삭제되지 않고 status=inactive 로 조회됨
    active_list = client.get(f"/api/v1/stores/{store_id}/menus", params={"status": "active"}).json()
    inactive_list = client.get(f"/api/v1/stores/{store_id}/menus", params={"status": "inactive"}).json()
    assert len(active_list) == 0
    assert len(inactive_list) == 1
    assert inactive_list[0]["id"] == menu["id"]

    # 재활성화
    reactivated = client.patch(
        f"/api/v1/stores/{store_id}/menus/{menu['id']}",
        json={"is_active": True},
    )
    assert reactivated.status_code == 200
    assert reactivated.json()["is_active"] is True


def test_ac5_validation_error_returns_field_details(client: TestClient) -> None:
    store = _create_store(client)
    store_id = store["id"]

    resp = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "   ", "selling_price": -500},
    )
    assert resp.status_code == 422
    err = resp.json()["error"]
    assert err["code"] == "VALIDATION_ERROR"
    fields = {d["field"] for d in err["details"]}
    assert "name" in fields
    assert "selling_price" in fields


def test_ac6_duplicate_active_menu_name_returns_409(client: TestClient) -> None:
    store = _create_store(client)
    store_id = store["id"]

    first = client.post(f"/api/v1/stores/{store_id}/menus", json={"name": "제육볶음"})
    assert first.status_code == 201

    dup = client.post(f"/api/v1/stores/{store_id}/menus", json={"name": " 제육볶음 "})
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "DUPLICATE_MENU_NAME"


def test_ac7_store_isolation_returns_404_for_other_store_menu(client: TestClient) -> None:
    store_a = _create_store(client, "매장 A")
    store_b = _create_store(client, "매장 B")
    menu_a = client.post(f"/api/v1/stores/{store_a['id']}/menus", json={"name": "돈까스"}).json()

    get_other = client.get(f"/api/v1/stores/{store_b['id']}/menus/{menu_a['id']}")
    assert get_other.status_code == 404
    assert get_other.json()["error"]["code"] == "MENU_NOT_FOUND"

    patch_other = client.patch(
        f"/api/v1/stores/{store_b['id']}/menus/{menu_a['id']}",
        json={"name": "침범시도"},
    )
    assert patch_other.status_code == 404


def test_ac8_audit_events_recorded_on_create_update_deactivate(
    client: TestClient, db_session: Session
) -> None:
    store = _create_store(client)
    store_id = store["id"]
    menu = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "된장찌개", "selling_price": 8000},
    ).json()
    client.patch(
        f"/api/v1/stores/{store_id}/menus/{menu['id']}",
        json={"selling_price": 8500},
    )
    client.patch(
        f"/api/v1/stores/{store_id}/menus/{menu['id']}",
        json={"is_active": False},
    )

    events = list(
        db_session.scalars(
            select(AuditEvent)
            .where(AuditEvent.entity_id == menu["id"])
            .order_by(AuditEvent.occurred_at.asc())
        ).all()
    )
    actions = [e.action for e in events]
    assert actions == ["created", "updated", "deactivated"]
    summary = json.loads(events[1].change_summary)
    assert Decimal(summary["before"]["selling_price"]) == Decimal("8000.00")
    assert Decimal(summary["after"]["selling_price"]) == Decimal("8500.00")
