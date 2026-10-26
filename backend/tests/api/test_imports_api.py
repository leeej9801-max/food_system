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


def test_ac1_pos_mode_unverified_vs_ready_csv(client: TestClient) -> None:
    store = client.post("/api/v1/stores", json={"name": "양식당 로마"}).json()
    store_id = store["id"]

    status_resp = client.get(f"/api/v1/stores/{store_id}/integrations/status")
    assert status_resp.status_code == 200
    body = status_resp.json()
    assert body["mode"] == "CSV_UPLOAD"
    assert body["connection_status"] == "READY_CSV"
    assert body["is_realtime"] is False

    # 모드 A (TOSS_OPEN_API) 변경 -> UNVERIFIED
    mode_a = client.patch(
        f"/api/v1/stores/{store_id}/integrations/mode",
        json={"mode": "TOSS_OPEN_API"},
    ).json()
    assert mode_a["mode"] == "TOSS_OPEN_API"
    assert mode_a["connection_status"] == "UNVERIFIED"
    assert mode_a["is_realtime"] is False

    # 모드 B (TOSS_PLUGIN) 변경 -> UNVERIFIED
    mode_b = client.patch(
        f"/api/v1/stores/{store_id}/integrations/mode",
        json={"mode": "TOSS_PLUGIN"},
    ).json()
    assert mode_b["mode"] == "TOSS_PLUGIN"
    assert mode_b["connection_status"] == "UNVERIFIED"


def test_ac2_ac3_ac4_ac5_ac6_csv_preview_commit_dedup_cancellation_and_mapping(
    client: TestClient,
) -> None:
    store = client.post("/api/v1/stores", json={"name": "비스트로 밀라노"}).json()
    store_id = store["id"]

    # 메뉴 2개 등록 (까르보나라, 알리오올리오) -> '부채살 스테이크'와 '하우스 와인(글라스)'는 처음엔 미매핑 상태
    m_carb = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "까르보나라", "category": "파스타", "price": "16000"},
    ).json()
    client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "알리오올리오", "category": "파스타", "price": "14000"},
    )
    m_steak = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "채끝 스테이크(메뉴마스터)", "category": "스테이크", "price": "29000"},
    ).json()

    csv_text = """order_id,ordered_at,menu_name,quantity,unit_price,status
ORD-101,2026-10-25 12:15:00,까르보나라,2,16000,COMPLETED
ORD-101,2026-10-25 12:15:00,알리오올리오,1,14000,COMPLETED
ORD-102,2026-10-25 13:20:00,부채살 스테이크,1,29000,COMPLETED
ORD-103,2026-10-25 19:05:00,까르보나라,1,16000,CANCELLED
,2026-10-25 19:10:00,까르보나라,1,16000,COMPLETED
ORD-104,2026-10-25 19:20:00,까르보나라,0,16000,COMPLETED
"""

    # AC-2: 미리보기 시 유효 행(4건), 오류 행(2건: 빈 주문번호, 수량 0), 미매핑 상품('부채살 스테이크') 분리
    preview_resp = client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/preview",
        json={"file_name": "oct25_sales.csv", "csv_text": csv_text},
    )
    assert preview_resp.status_code == 200
    preview = preview_resp.json()
    assert preview["rows_total"] == 6
    assert preview["rows_valid"] == 4
    assert preview["rows_error"] == 2
    assert preview["rows_unmapped"] == 1
    assert preview["unmapped_product_names"] == ["부채살 스테이크"]
    assert preview["duplicate_file_warning"] is False

    # AC-3 & AC-5: 커밋 반영 (유효 주문 3건 중 취소 1건 제외 -> 완료 주문 2건, 순매출 = 32000 + 14000 + 29000 = 75000, 순수량 = 4)
    commit_resp = client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/{preview['batch_id']}/commit"
    )
    assert commit_resp.status_code == 200
    commit_body = commit_resp.json()
    assert commit_body["orders_upserted"] == 3
    assert commit_body["items_recorded"] == 4
    assert commit_body["unmapped_count"] == 1

    status_after = client.get(f"/api/v1/stores/{store_id}/integrations/status").json()
    assert status_after["total_orders_count"] == 2  # ORD-103은 CANCELLED이므로 제외
    assert Decimal(status_after["net_sales_amount"]) == Decimal("75000.00")
    assert status_after["net_items_quantity"] == 4
    assert status_after["unmapped_products"] == ["부채살 스테이크"]
    assert status_after["last_synced_at"] is not None

    # AC-4: 동일 CSV 재업로드 시 duplicate_file_warning = True 및 재커밋 시 멱등성(중복 합산 방지) 검증
    preview_dup = client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/preview",
        json={"file_name": "oct25_sales_copy.csv", "csv_text": csv_text},
    ).json()
    assert preview_dup["duplicate_file_warning"] is True

    client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/{preview_dup['batch_id']}/commit"
    )
    status_after_dup = client.get(
        f"/api/v1/stores/{store_id}/integrations/status"
    ).json()
    assert status_after_dup["total_orders_count"] == 2
    assert Decimal(status_after_dup["net_sales_amount"]) == Decimal("75000.00")
    assert status_after_dup["net_items_quantity"] == 4

    # AC-6: 미매핑 외부 상품명('부채살 스테이크')을 내부 메뉴('채끝 스테이크(메뉴마스터)')에 매핑하면 기존 판매 항목도 MAPPED로 소급 갱신
    map_resp = client.post(
        f"/api/v1/stores/{store_id}/integrations/mappings",
        json={
            "external_product_name": "부채살 스테이크",
            "menu_item_id": m_steak["id"],
        },
    )
    assert map_resp.status_code == 200
    map_body = map_resp.json()
    assert map_body["retroactive_updated_items"] == 1
    assert map_body["menu_item_id"] == m_steak["id"]
    assert m_carb["id"] != m_steak["id"]

    status_after_map = client.get(
        f"/api/v1/stores/{store_id}/integrations/status"
    ).json()
    assert status_after_map["unmapped_products"] == []


def test_wo007_utf8_bom_csv_and_retroactive_menu_creation_linking(
    client: TestClient,
) -> None:
    store = client.post("/api/v1/stores", json={"name": "양식당 베로나"}).json()
    store_id = store["id"]

    # 1. 메뉴 미등록 상태에서 Excel UTF-8 BOM(\ufeff) 포함 CSV를 먼저 업로드·커밋
    bom_csv = "\ufefforder_id,ordered_at,menu_name,quantity,unit_price,status\nORD-901,2026-10-25 13:00:00,Truffle Gnocchi,2,19000,COMPLETED\n"
    preview = client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/preview",
        json={"file_name": "bom_sales.csv", "csv_text": bom_csv},
    ).json()
    assert preview["rows_valid"] == 1
    assert preview["rows_error"] == 0
    assert preview["unmapped_product_names"] == ["Truffle Gnocchi"]

    client.post(
        f"/api/v1/stores/{store_id}/imports/sales-csv/{preview['batch_id']}/commit"
    )
    status1 = client.get(f"/api/v1/stores/{store_id}/integrations/status").json()
    assert status1["unmapped_products"] == ["Truffle Gnocchi"]

    # 2. 이후 S03에서 대소문자가 다른 'truffle gnocchi' 메뉴를 신규 등록 -> 기존 UNMAPPED 판매 항목이 자동 소급 연결되고 pos_mapping_status == LINKED 반환
    created_menu = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "truffle gnocchi", "selling_price": "19000"},
    ).json()
    assert created_menu["pos_mapping_status"] == "LINKED"

    status2 = client.get(f"/api/v1/stores/{store_id}/integrations/status").json()
    assert status2["unmapped_products"] == []


def test_wo008_sales_order_refund_and_pos_vs_csv_mode_branching(
    client: TestClient,
) -> None:
    store = client.post(
        "/api/v1/stores",
        json={
            "name": "비스트로 밀라노",
            "business_days": "화,수,목,금,토,일",
            "opening_hours": "11:30-22:00",
            "initial_table_count": 4,
        },
    ).json()
    store_id = store["id"]

    # 식자재 + 메뉴 + 레시피 + 초기 입고 설정
    ing = client.post(
        f"/api/v1/stores/{store_id}/ingredients",
        json={
            "name": "파스타면",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": "1000",
        },
    ).json()
    menu = client.post(
        f"/api/v1/stores/{store_id}/menus",
        json={"name": "봉골레 파스타", "selling_price": "15000"},
    ).json()
    client.put(
        f"/api/v1/stores/{store_id}/menus/{menu['id']}/recipe",
        json={
            "status": "COMPLETE",
            "items": [{"ingredient_id": ing["id"], "quantity": "100"}],
        },
    )
    client.post(
        f"/api/v1/stores/{store_id}/inventory/receipts",
        json={
            "ingredient_id": ing["id"],
            "purchase_quantity": "1",
            "total_cost": "5000",
        },
    )

    # 1. CSV_UPLOAD 모드에서 현장 수동 주문 생성 (2개 -> 30,000원, 파스타면 200g 소모)
    created_order_resp = client.post(
        f"/api/v1/stores/{store_id}/sales-orders",
        json={"items": [{"menu_item_id": menu["id"], "quantity": 2}]},
    )
    assert created_order_resp.status_code == 201
    order = created_order_resp.json()
    order_id = order["id"]
    item_id = order["items"][0]["id"]
    assert Decimal(order["total_amount"]) == Decimal("30000.00")

    inv1 = client.get(f"/api/v1/stores/{store_id}/inventory/summary").json()[0]
    assert Decimal(inv1["theoretical_consumption_base"]) == Decimal("200.000")
    assert Decimal(inv1["estimated_quantity"]) == Decimal("800.000")

    # 2. CSV_UPLOAD 모드에서 주문 수량 2개 -> 3개로 수정 (45,000원, 300g 소모)
    patched_qty = client.patch(
        f"/api/v1/stores/{store_id}/sales-orders/{order_id}",
        json={"items": [{"item_id": item_id, "quantity": 3}]},
    )
    assert patched_qty.status_code == 200
    assert Decimal(patched_qty.json()["total_amount"]) == Decimal("45000.00")

    inv2 = client.get(f"/api/v1/stores/{store_id}/inventory/summary").json()[0]
    assert Decimal(inv2["theoretical_consumption_base"]) == Decimal("300.000")
    assert Decimal(inv2["estimated_quantity"]) == Decimal("700.000")

    # 3. 환불/주문취소(CANCELLED) 처리 시 순매출 0원 및 재고 소모량 즉시 복원(1000g)
    refunded = client.patch(
        f"/api/v1/stores/{store_id}/sales-orders/{order_id}",
        json={"order_status": "CANCELLED"},
    )
    assert refunded.status_code == 200
    assert refunded.json()["order_status"] == "CANCELLED"

    inv3 = client.get(f"/api/v1/stores/{store_id}/inventory/summary").json()[0]
    assert Decimal(inv3["theoretical_consumption_base"]) == Decimal("0.000")
    assert Decimal(inv3["estimated_quantity"]) == Decimal("1000.000")

    # 4. POS 연동 모드(TOSS_OPEN_API)로 변경 시 수동 수정은 409 Conflict로 차단됨
    client.patch(
        f"/api/v1/stores/{store_id}/integrations/mode",
        json={"mode": "TOSS_OPEN_API"},
    )
    orders_list = client.get(f"/api/v1/stores/{store_id}/sales-orders").json()
    assert orders_list["can_manual_edit"] is False

    locked_resp = client.patch(
        f"/api/v1/stores/{store_id}/sales-orders/{order_id}",
        json={"order_status": "COMPLETED"},
    )
    assert locked_resp.status_code == 409
    assert locked_resp.json()["error"]["code"] == "POS_MODE_MANUAL_EDIT_LOCKED"


