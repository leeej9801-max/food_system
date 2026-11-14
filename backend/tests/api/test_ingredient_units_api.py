"""U-51: 단위는 서버가 바꾸고, 식자재 상태와 화면 카드 값은 서버가 계산한다."""

from decimal import Decimal

from fastapi.testclient import TestClient


def _store(client: TestClient) -> str:
    return client.post("/api/v1/stores", json={"name": "단위 시험 매장"}).json()["id"]


def _ing(client: TestClient, store_id: str, **body: object) -> dict:
    resp = client.post(f"/api/v1/stores/{store_id}/ingredients", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_with_unit_converts_safety_stock_to_base(client: TestClient) -> None:
    s = _store(client)
    flour = _ing(client, s, name="밀가루", unit="kg", safety_stock="2")
    assert flour["base_unit"] == "g"
    assert flour["purchase_unit"] == "kg"
    assert Decimal(str(flour["conversion_factor"])) == 1000
    assert Decimal(str(flour["safety_stock"])) == 2000
    milk = _ing(client, s, name="우유", unit="L")
    assert (milk["base_unit"], milk["purchase_unit"]) == ("ml", "L")


def test_update_unit_converts_and_rejects_other_dimension(client: TestClient) -> None:
    s = _store(client)
    flour = _ing(client, s, name="밀가루", unit="g")
    url = f"/api/v1/stores/{s}/ingredients/{flour['id']}"

    ok = client.patch(url, json={"unit": "kg", "safety_stock": "1.5"})
    assert ok.status_code == 200
    assert Decimal(str(ok.json()["safety_stock"])) == 1500
    assert ok.json()["purchase_unit"] == "kg"

    bad = client.patch(url, json={"unit": "ml"})
    assert bad.status_code == 422
    assert bad.json()["code"] == "UNIT_MISMATCH"

    assert (
        client.post(
            f"/api/v1/stores/{s}/ingredients", json={"name": "x", "unit": "pack"}
        ).status_code
        == 422
    )


def test_receipt_in_any_unit_of_same_dimension(client: TestClient) -> None:
    s = _store(client)
    flour = _ing(client, s, name="밀가루", unit="kg")
    resp = client.post(
        f"/api/v1/stores/{s}/inventory/receipts",
        json={
            "ingredient_id": flour["id"],
            "purchase_quantity": "500",
            "purchase_unit": "g",
            "total_cost": "1000",
        },
    )
    assert resp.status_code == 201, resp.text
    assert Decimal(str(resp.json()["base_quantity"])) == 500
    assert resp.json()["purchase_unit"] == "g"

    bad = client.post(
        f"/api/v1/stores/{s}/inventory/receipts",
        json={
            "ingredient_id": flour["id"],
            "purchase_quantity": "1",
            "purchase_unit": "ea",
            "total_cost": "1000",
        },
    )
    assert bad.status_code == 422


def test_stock_status_and_insights(client: TestClient) -> None:
    s = _store(client)
    pasta = _ing(
        client, s, name="파스타면", unit="kg", safety_stock="1"
    )  # 연결 + 재고 0 → 입고필요
    cream = _ing(client, s, name="생크림", unit="ml")  # 연결, 안전재고 없음 → 사용중
    _ing(client, s, name="트러플", unit="g")  # 연결 없음 → 대기
    off = _ing(client, s, name="옛 재료", unit="g", is_active=False)  # → 비활성

    menu = client.post(
        f"/api/v1/stores/{s}/menus", json={"name": "크림 파스타", "selling_price": "15000"}
    ).json()
    client.post(f"/api/v1/stores/{s}/menus", json={"name": "샐러드", "selling_price": "9000"})
    client.put(
        f"/api/v1/stores/{s}/menus/{menu['id']}/recipe",
        json={
            "status": "COMPLETE",
            "items": [
                {"ingredient_id": pasta["id"], "quantity": "100"},
                {"ingredient_id": cream["id"], "quantity": "50"},
            ],
        },
    )
    order = client.post(
        f"/api/v1/stores/{s}/sales-orders",
        json={"items": [{"menu_item_id": menu["id"], "quantity": 2}]},
    )
    assert order.status_code == 201, order.text

    rows = {
        r["name"]: r["stock_status"] for r in client.get(f"/api/v1/stores/{s}/ingredients").json()
    }
    assert rows == {
        "파스타면": "NEEDS_RESTOCK",
        "생크림": "IN_USE",
        "트러플": "IDLE",
        "옛 재료": "INACTIVE",
    }
    assert off["id"]

    ins = client.get(f"/api/v1/stores/{s}/ingredients/insights")
    assert ins.status_code == 200, ins.text
    body = ins.json()
    assert [(r["name"], Decimal(str(r["value"])), r["unit"]) for r in body["recent_usage"]] == [
        ("파스타면", Decimal(200), "g"),
        ("생크림", Decimal(100), "ml"),
    ]
    assert [r["name"] for r in body["linked_menus"]] == ["생크림", "파스타면"]
    assert [m["name"] for m in body["menus_without_recipe"]] == ["샐러드"]
