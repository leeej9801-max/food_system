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
    TestingSessionLocal = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
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


def _create_store(client: TestClient, name: str = "양식 비스트로 파일럿") -> dict:
    resp = client.post("/api/v1/stores", json={"name": name})
    assert resp.status_code == 201
    return resp.json()


def test_ac1_ingredient_crud_duplicate_and_deactivate(client: TestClient) -> None:
    store = _create_store(client)
    store_id = store["id"]

    created = client.post(
        f"/api/v1/stores/{store_id}/ingredients",
        json={
            "name": " 스파게티면 ",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": "1000",
            "safety_stock": "2000",
        },
    )
    assert created.status_code == 201
    ing = created.json()
    assert ing["name"] == "스파게티면"
    assert Decimal(str(ing["conversion_factor"])) == Decimal("1000.0000")
    assert ing["linked_menu_count"] == 0

    # 활성 식자재 중복 생성 시 409
    dup = client.post(
        f"/api/v1/stores/{store_id}/ingredients",
        json={"name": "스파게티면", "base_unit": "g", "purchase_unit": "kg"},
    )
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "DUPLICATE_INGREDIENT_NAME"

    # 비활성화 후 조회
    deactivated = client.patch(
        f"/api/v1/stores/{store_id}/ingredients/{ing['id']}",
        json={"is_active": False},
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    inactive_list = client.get(
        f"/api/v1/stores/{store_id}/ingredients", params={"status": "inactive"}
    ).json()
    assert len(inactive_list) == 1


def test_ac2_ingredient_invalid_conversion_factor_returns_422(client: TestClient) -> None:
    store = _create_store(client)
    resp = client.post(
        f"/api/v1/stores/{store['id']}/ingredients",
        json={
            "name": "올리브오일",
            "base_unit": "ml",
            "purchase_unit": "L",
            "conversion_factor": 0,
        },
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_ac3_ac4_ac5_recipe_upsert_links_menu_and_ingredient_and_audits(
    client: TestClient, db_session: Session
) -> None:
    store = _create_store(client)
    store_id = store["id"]

    menu = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "까르보나라", "selling_price": 16000, "category": "파스타"},
    ).json()
    pasta = client.post(
        f"/api/v1/stores/{store_id}/ingredients",
        json={"name": "스파게티면", "base_unit": "g", "purchase_unit": "kg", "conversion_factor": 1000},
    ).json()
    bacon = client.post(
        f"/api/v1/stores/{store_id}/ingredients",
        json={"name": "베이컨", "base_unit": "g", "purchase_unit": "kg", "conversion_factor": 1000},
    ).json()

    # AC-4: 중복 식자재를 한 레시피에 넣으면 422 차단
    dup_resp = client.put(
        f"/api/v1/stores/{store_id}/menus/{menu['id']}/recipe",
        json={
            "status": "COMPLETE",
            "items": [
                {"ingredient_id": pasta["id"], "quantity": 100},
                {"ingredient_id": pasta["id"], "quantity": 50},
            ],
        },
    )
    assert dup_resp.status_code == 422
    assert dup_resp.json()["error"]["code"] == "DUPLICATE_RECIPE_INGREDIENT"

    # 정상 레시피 등록 (version 1)
    put_v1 = client.put(
        f"/api/v1/stores/{store_id}/menus/{menu['id']}/recipe",
        json={
            "status": "PARTIAL",
            "items": [
                {"ingredient_id": pasta["id"], "quantity": 110, "notes": "건면 기준"},
            ],
        },
    )
    assert put_v1.status_code == 200
    r1 = put_v1.json()
    assert r1["version"] == 1
    assert r1["status"] == "PARTIAL"
    assert len(r1["items"]) == 1
    assert r1["items"][0]["unit"] == "g"

    # 레시피 수정 (version 2, COMPLETE)
    put_v2 = client.put(
        f"/api/v1/stores/{store_id}/menus/{menu['id']}/recipe",
        json={
            "status": "COMPLETE",
            "items": [
                {"ingredient_id": pasta["id"], "quantity": 110},
                {"ingredient_id": bacon["id"], "quantity": 45},
            ],
        },
    )
    assert put_v2.status_code == 200
    r2 = put_v2.json()
    assert r2["version"] == 2
    assert r2["status"] == "COMPLETE"
    assert len(r2["items"]) == 2

    # 메뉴 목록에서 recipe_status 및 recipe_item_count 반영 확인
    menus = client.get(f"/api/v1/stores/{store_id}/menus").json()
    assert menus[0]["recipe_status"] == "COMPLETE"
    assert menus[0]["recipe_item_count"] == 2

    # 식자재 목록에서 linked_menu_count 반영 및 usages 조회 확인
    ings = client.get(f"/api/v1/stores/{store_id}/ingredients").json()
    for ing_row in ings:
        assert ing_row["linked_menu_count"] == 1

    usages = client.get(f"/api/v1/stores/{store_id}/ingredients/{pasta['id']}/usages").json()
    assert len(usages) == 1
    assert usages[0]["menu_name"] == "까르보나라"
    assert Decimal(str(usages[0]["quantity"])) == Decimal("110.000")

    # AC-5: 레시피 audit_events 기록 확인
    events = list(
        db_session.scalars(
            select(AuditEvent).where(AuditEvent.entity_type == "recipe")
        ).all()
    )
    assert len(events) == 2


def test_ac6_patch_menu_selling_price_to_null(client: TestClient) -> None:
    store = _create_store(client)
    store_id = store["id"]
    menu = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "트러플 감자튀김", "selling_price": 9500},
    ).json()
    assert menu["selling_price"] is not None

    cleared = client.patch(
        f"/api/v1/stores/{store_id}/menus/{menu['id']}",
        json={"selling_price": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["selling_price"] is None
