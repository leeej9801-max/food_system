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


def test_ac1_ac2_receipts_preserve_price_history_and_convert_units(
    client: TestClient,
) -> None:
    store = client.post("/api/v1/stores", json={"name": "트attoria 베네치아"}).json()
    store_id = store["id"]

    # 식자재: 파스타면 (기본 g, 구매 kg, 변환계수 1000, 안전재고 500g)
    ing = client.post(
        f"/api/v1/stores/{store_id}/ingredients",
        json={
            "name": "스파게티면",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": "1000",
            "safety_stock": "500",
        },
    ).json()
    ing_id = ing["id"]

    # 1차 입고: 2 kg, 총액 24,000원 -> 기본단위 2000g, kg당 12,000원, g당 12원
    r1 = client.post(
        f"/api/v1/stores/{store_id}/inventory/receipts",
        json={
            "ingredient_id": ing_id,
            "purchase_quantity": "2",
            "total_cost": "24000",
            "supplier_name": "이탈리아푸드",
        },
    )
    assert r1.status_code == 201
    r1_body = r1.json()
    assert Decimal(r1_body["base_quantity"]) == Decimal("2000.000")
    assert Decimal(r1_body["unit_cost_per_purchase"]) == Decimal("12000.00")
    assert Decimal(r1_body["unit_cost_per_base"]) == Decimal("12.0000")

    # 2차 입고: 2 kg, 총액 30,000원 -> 기본단위 2000g, kg당 15,000원, g당 15원
    r2 = client.post(
        f"/api/v1/stores/{store_id}/inventory/receipts",
        json={
            "ingredient_id": ing_id,
            "purchase_quantity": "2",
            "total_cost": "30000",
            "supplier_name": "이탈리아푸드",
        },
    )
    assert r2.status_code == 201
    r2_body = r2.json()
    assert Decimal(r2_body["unit_cost_per_base"]) == Decimal("15.0000")

    # AC-1: 과거 입고 단가 이력이 덮어써지지 않고 2건 모두 보존되며 최신 단가(15원/g)가 요약에 반영됨
    receipts = client.get(
        f"/api/v1/stores/{store_id}/inventory/receipts?ingredient_id={ing_id}"
    ).json()
    assert len(receipts) == 2
    assert Decimal(receipts[0]["unit_cost_per_base"]) == Decimal("15.0000")
    assert Decimal(receipts[1]["unit_cost_per_base"]) == Decimal("12.0000")

    summary = client.get(f"/api/v1/stores/{store_id}/inventory/summary").json()
    assert len(summary) == 1
    item = summary[0]
    assert Decimal(item["latest_unit_cost_per_base"]) == Decimal("15.0000")
    assert Decimal(item["receipts_since_count_base"]) == Decimal("4000.000")
    assert Decimal(item["estimated_quantity"]) == Decimal("4000.000")
    assert item["last_actual_quantity"] is None
    assert item["stock_status"] == "OK"


def test_ac3_ac4_ac5_theoretical_consumption_actual_count_separation_and_alerts(
    client: TestClient,
) -> None:
    store = client.post("/api/v1/stores", json={"name": "비스트로 피렌체"}).json()
    store_id = store["id"]

    # 식자재: 관찰레 (기본 g, 구매 kg, 변환계수 1000, 안전재고 300g)
    ing = client.post(
        f"/api/v1/stores/{store_id}/ingredients",
        json={
            "name": "관찰레",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": "1000",
            "safety_stock": "300",
        },
    ).json()
    ing_id = ing["id"]

    # 메뉴: 까르보나라 -> 레시피에 관찰레 50g 투입
    menu = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "까르보나라", "category": "파스타", "price": "16000"},
    ).json()
    client.put(
        f"/api/v1/stores/{store_id}/menus/{menu['id']}/recipe",
        json={"items": [{"ingredient_id": ing_id, "quantity": "50"}]},
    )

    # 입고: 0.5 kg = 500 g
    client.post(
        f"/api/v1/stores/{store_id}/inventory/receipts",
        json={
            "ingredient_id": ing_id,
            "purchase_quantity": "0.5",
            "total_cost": "15000",
        },
    )

    # 판매 CSV 반영: 까르보나라 완료 4개(=200g 소모), 취소 2개(차감 제외)
    csv_text = """order_id,ordered_at,menu_name,quantity,unit_price,status
ORD-201,2026-10-25 12:00:00,까르보나라,4,16000,COMPLETED
ORD-202,2026-10-25 12:30:00,까르보나라,2,16000,CANCELLED
"""
    preview = client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/preview",
        json={"file_name": "sales.csv", "csv_text": csv_text},
    ).json()
    client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/{preview['batch_id']}/commit"
    )

    # AC-3 & AC-5: 입고 500g - 이론소모 200g = 예상재고 300g -> 안전재고(300g) 이하이므로 LOW_STOCK
    summary1 = client.get(f"/api/v1/stores/{store_id}/inventory/summary").json()[0]
    assert Decimal(summary1["theoretical_consumption_base"]) == Decimal("200.000")
    assert Decimal(summary1["estimated_quantity"]) == Decimal("300.000")
    assert summary1["last_actual_quantity"] is None
    assert summary1["stock_status"] == "LOW_STOCK"

    # 폐기 조정: -350g -> 예상재고 -50g -> NEGATIVE_WARNING
    adj_resp = client.post(
        f"/api/v1/stores/{store_id}/inventory/adjustments",
        json={"ingredient_id": ing_id, "quantity_delta": "-350", "reason": "WASTE"},
    )
    assert adj_resp.status_code == 201

    summary2 = client.get(f"/api/v1/stores/{store_id}/inventory/summary").json()[0]
    assert Decimal(summary2["estimated_quantity"]) == Decimal("-50.000")
    assert summary2["stock_status"] == "NEGATIVE_WARNING"

    # AC-4: 실재고 실사(inventory_counts) 450g 입력 -> 실재고(450g)와 예상재고(450g) 분리 표시 및 기준점 리셋
    count_resp = client.post(
        f"/api/v1/stores/{store_id}/inventory/counts",
        json={"ingredient_id": ing_id, "actual_quantity": "450", "notes": "마감 실사"},
    )
    assert count_resp.status_code == 201

    summary3 = client.get(f"/api/v1/stores/{store_id}/inventory/summary").json()[0]
    assert Decimal(summary3["last_actual_quantity"]) == Decimal("450.000")
    assert Decimal(summary3["receipts_since_count_base"]) == Decimal("0.000")
    assert Decimal(summary3["theoretical_consumption_base"]) == Decimal("0.000")
    assert Decimal(summary3["adjustments_since_count_base"]) == Decimal("0.000")
    assert Decimal(summary3["estimated_quantity"]) == Decimal("450.000")
    assert summary3["stock_status"] == "OK"

    # WO-007 AC-3: 실재고 실사 이후에 과거 영업일(2020-01-01)의 지연 CSV를 업로드하더라도 현재 예상 재고(450g)에서 중복 차감되지 않아야 함
    old_csv = """order_id,ordered_at,menu_name,quantity,unit_price,status
ORD-OLD-01,2020-01-01 12:00:00,까르보나라,3,16000,COMPLETED
"""
    old_prev = client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/preview",
        json={"file_name": "old_sales.csv", "csv_text": old_csv},
    ).json()
    client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/{old_prev['batch_id']}/commit"
    )
    summary4 = client.get(f"/api/v1/stores/{store_id}/inventory/summary").json()[0]
    assert Decimal(summary4["theoretical_consumption_base"]) == Decimal("0.000")
    assert Decimal(summary4["estimated_quantity"]) == Decimal("450.000")

