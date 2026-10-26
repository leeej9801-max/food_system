from collections.abc import Generator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
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


def test_ac1_ac2_ac3_menu_costing_and_non_destructive_simulation(
    client: TestClient,
) -> None:
    store = client.post("/api/v1/stores", json={"name": "양식당 나폴리"}).json()
    store_id = store["id"]

    # 식자재 3종 등록: 스파게티면(입고 O), 관찰레(입고 O), 트러플오일(입고 X)
    ing_pasta = client.post(
        f"/api/v1/stores/{store_id}/ingredients",
        json={
            "name": "스파게티면",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": "1000",
        },
    ).json()
    ing_guanciale = client.post(
        f"/api/v1/stores/{store_id}/ingredients",
        json={
            "name": "관찰레",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": "1000",
        },
    ).json()
    ing_truffle = client.post(
        f"/api/v1/stores/{store_id}/ingredients",
        json={
            "name": "트러플오일",
            "base_unit": "ml",
            "purchase_unit": "ml",
            "conversion_factor": "1",
        },
    ).json()

    # 입고 등록: 스파게티면 1kg = 15,000원 (15원/g), 관찰레 1kg = 30,000원 (30원/g)
    client.post(
        f"/api/v1/stores/{store_id}/inventory/receipts",
        json={
            "ingredient_id": ing_pasta["id"],
            "purchase_quantity": "1",
            "total_cost": "15000",
        },
    )
    client.post(
        f"/api/v1/stores/{store_id}/inventory/receipts",
        json={
            "ingredient_id": ing_guanciale["id"],
            "purchase_quantity": "1",
            "total_cost": "30000",
        },
    )

    # 메뉴 1: 까르보나라 (판매가 16,000원, 스파게티면 120g + 관찰레 50g -> 1800 + 1500 = 3300원)
    m_carb = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "까르보나라", "category": "파스타", "selling_price": "16000"},
    ).json()
    client.put(
        f"/api/v1/stores/{store_id}/menus/{m_carb['id']}/recipe",
        json={
            "items": [
                {"ingredient_id": ing_pasta["id"], "quantity": "120"},
                {"ingredient_id": ing_guanciale["id"], "quantity": "50"},
            ]
        },
    )

    # 메뉴 2: 트러플 파스타 (입고 단가 미등록 식자재 포함)
    m_truffle = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "트러플 파스타", "category": "파스타", "selling_price": "22000"},
    ).json()
    client.put(
        f"/api/v1/stores/{store_id}/menus/{m_truffle['id']}/recipe",
        json={
            "items": [
                {"ingredient_id": ing_pasta["id"], "quantity": "120"},
                {"ingredient_id": ing_truffle["id"], "quantity": "10"},
            ]
        },
    )

    # AC-1 & AC-2: 기본(0%) 원가 조회
    base_resp = client.post(
        f"/api/v1/stores/{store_id}/analytics/costing",
        json={"global_change_percent": "0"},
    )
    assert base_resp.status_code == 200
    menus = {m["menu_name"]: m for m in base_resp.json()["menus"]}

    carb = menus["까르보나라"]
    assert carb["cost_status"] == "COMPLETE"
    assert Decimal(carb["base_recipe_cost"]) == Decimal("3300.00")
    assert Decimal(carb["base_margin"]) == Decimal("12700.00")
    assert Decimal(carb["base_cost_ratio_percent"]) == Decimal("20.63")

    truf = menus["트러플 파스타"]
    assert truf["cost_status"] == "INCOMPLETE_COST"
    assert truf["missing_cost_ingredients"] == ["트러플오일"]

    # AC-3: +10% 비파괴 단가 변동 시나리오 -> 3,300 * 1.1 = 3,630원, 원가율 22.69%
    sim_resp = client.post(
        f"/api/v1/stores/{store_id}/analytics/costing",
        json={"global_change_percent": "10"},
    ).json()
    carb_sim = {m["menu_name"]: m for m in sim_resp["menus"]}["까르보나라"]
    assert Decimal(carb_sim["base_recipe_cost"]) == Decimal("3300.00")
    assert Decimal(carb_sim["simulated_recipe_cost"]) == Decimal("3630.00")
    assert Decimal(carb_sim["cost_delta"]) == Decimal("330.00")
    assert Decimal(carb_sim["simulated_cost_ratio_percent"]) == Decimal("22.69")

    # 시뮬레이션 후 다시 0% 조회 시 원래 원가(3,300원)가 그대로 유지됨 (비파괴 검증)
    after_resp = client.post(
        f"/api/v1/stores/{store_id}/analytics/costing",
        json={"global_change_percent": "0"},
    ).json()
    carb_after = {m["menu_name"]: m for m in after_resp["menus"]}["까르보나라"]
    assert Decimal(carb_after["simulated_recipe_cost"]) == Decimal("3300.00")


def test_ac4_hourly_and_menu_sales_aggregation_separates_date_only_and_cancelled(
    client: TestClient,
) -> None:
    store = client.post("/api/v1/stores", json={"name": "비스트로 토리노"}).json()
    store_id = store["id"]

    client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "까르보나라", "category": "파스타", "price": "16000"},
    )

    # ORD-301: 12시 정각 (시각 존재, 수량 2)
    # ORD-302: 일자만 존재 (2026-10-25, 수량 3 -> unknown_hour_quantity로 분리)
    # ORD-303: CANCELLED (집계 제외)
    csv_text = """order_id,ordered_at,menu_name,quantity,unit_price,status
ORD-301,2026-10-25 12:15:00,까르보나라,2,16000,COMPLETED
ORD-302,2026-10-25,까르보나라,3,16000,COMPLETED
ORD-303,2026-10-25 18:00:00,까르보나라,1,16000,CANCELLED
"""
    preview = client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/preview",
        json={"file_name": "sales.csv", "csv_text": csv_text},
    ).json()
    client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/{preview['batch_id']}/commit"
    )

    sales_resp = client.get(f"/api/v1/stores/{store_id}/analytics/sales")
    assert sales_resp.status_code == 200
    body = sales_resp.json()
    assert body["total_completed_orders"] == 2
    assert body["total_quantity"] == 5
    assert Decimal(body["total_net_sales"]) == Decimal("80000.00")
    assert body["known_hour_quantity"] == 2
    assert body["unknown_hour_quantity"] == 3

    buckets_by_hour = {b["hour"]: b for b in body["hourly_buckets"]}
    assert buckets_by_hour[12]["quantity"] == 2
    assert Decimal(buckets_by_hour[12]["sales_amount"]) == Decimal("32000.00")
    assert buckets_by_hour[0]["quantity"] == 0  # 일자만 있는 주문이 0시에 왜곡 편입되지 않음


def test_western_bistro_demo_seed_idempotent_and_no_fake_sales(
    client: TestClient,
) -> None:
    store = client.post("/api/v1/stores", json={"name": "프로토타입 비스트로"}).json()
    store_id = store["id"]

    seed1 = client.post(f"/api/v1/stores/{store_id}/seed-western-demo")
    assert seed1.status_code == 200
    assert seed1.json()["ingredients_created"] == 5
    assert seed1.json()["menus_created"] == 4
    assert seed1.json()["receipts_created"] == 5

    # 재호출 시 중복 생성되지 않음 (멱등성)
    seed2 = client.post(f"/api/v1/stores/{store_id}/seed-western-demo")
    assert seed2.status_code == 200
    assert seed2.json()["ingredients_created"] == 0
    assert seed2.json()["menus_created"] == 0
    assert seed2.json()["receipts_created"] == 0

    # 가짜 판매 매출은 자동 주입되지 않아야 함
    sales = client.get(f"/api/v1/stores/{store_id}/analytics/sales").json()
    assert sales["total_completed_orders"] == 0
    assert Decimal(sales["total_net_sales"]) == Decimal("0.00")

