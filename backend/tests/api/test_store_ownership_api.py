"""안전망 (WO-20261110-002 2단계): 다른 매장 경로로 남의 리소스에 접근하면 막힌다.

SQLite에서 돌기 때문에 RLS 없이 서비스 계층의 store_id 조건만 검증한다.
RLS 쪽은 tests/isolation이 맡는다. 구현을 바꾸지 않고 현재 동작을 고정한다.
"""

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient


@dataclass
class Stores:
    a: str  # 리소스를 가진 매장
    b: str  # 침범을 시도하는 매장
    menu: str
    ingredient: str
    table: str
    visit: str
    order: str
    order_item: str


@pytest.fixture
def stores(client: TestClient) -> Stores:
    a = client.post("/api/v1/stores", json={"name": "매장 A"}).json()["id"]
    b = client.post("/api/v1/stores", json={"name": "매장 B"}).json()["id"]
    base = f"/api/v1/stores/{a}"
    assert client.post(f"{base}/seed-western-demo").status_code == 200
    menu = client.get(f"{base}/menus").json()[0]["id"]
    ingredient = client.get(f"{base}/ingredients").json()[0]["id"]
    table = client.get(f"{base}/tables").json()[0]["id"]
    visit = client.post(f"{base}/visits", json={"table_id": table, "party_size": 2})
    assert visit.status_code == 201
    order = client.post(
        f"{base}/sales-orders", json={"items": [{"menu_item_id": menu, "quantity": 1}]}
    )
    assert order.status_code == 201
    return Stores(
        a=a,
        b=b,
        menu=menu,
        ingredient=ingredient,
        table=table,
        visit=visit.json()["id"],
        order=order.json()["id"],
        order_item=order.json()["items"][0]["id"],
    )


# (메서드, 매장 B 기준 경로, 본문). 경로·본문의 {이름}은 매장 A의 리소스 ID로 바뀐다.
CROSS_STORE_CALLS = [
    ("GET", "/menus/{menu}", None),
    ("PATCH", "/menus/{menu}", {"name": "침범"}),
    ("GET", "/menus/{menu}/recipe", None),
    ("PUT", "/menus/{menu}/recipe", {"items": []}),
    ("GET", "/ingredients/{ingredient}", None),
    ("PATCH", "/ingredients/{ingredient}", {"name": "침범"}),
    ("GET", "/ingredients/{ingredient}/usages", None),
    (
        "POST",
        "/inventory/receipts",
        {"ingredient_id": "{ingredient}", "purchase_quantity": "1", "total_cost": "1000"},
    ),
    ("POST", "/inventory/counts", {"ingredient_id": "{ingredient}", "actual_quantity": "1"}),
    ("POST", "/inventory/adjustments", {"ingredient_id": "{ingredient}", "quantity_delta": "1"}),
    ("PATCH", "/tables/{table}", {"name": "침범"}),
    ("GET", "/tables/{table}/qr-token", None),
    ("POST", "/tables/{table}/qr-token", None),
    ("POST", "/visits", {"table_id": "{table}", "party_size": 2}),
    ("PATCH", "/visits/{visit}", {"status": "LEFT"}),
    ("PATCH", "/visits/{visit}/slots/1", {"gender": None}),
    ("POST", "/sales-orders", {"items": [{"menu_item_id": "{menu}", "quantity": 1}]}),
    ("PATCH", "/sales-orders/{order}", {"order_status": "CANCELLED"}),
    ("POST", "/integrations/mappings", {"external_product_name": "침범", "menu_item_id": "{menu}"}),
]


def _fill(value, ids: dict[str, str]):
    if isinstance(value, str):
        return value.format(**ids)
    if isinstance(value, dict):
        return {k: _fill(v, ids) for k, v in value.items()}
    if isinstance(value, list):
        return [_fill(v, ids) for v in value]
    return value


@pytest.mark.parametrize(
    ("method", "path", "body"), CROSS_STORE_CALLS, ids=[f"{m} {p}" for m, p, _ in CROSS_STORE_CALLS]
)
def test_other_store_resource_is_not_found(
    client: TestClient, stores: Stores, method: str, path: str, body: dict | None
) -> None:
    ids = vars(stores)
    resp = client.request(
        method, f"/api/v1/stores/{stores.b}{_fill(path, ids)}", json=_fill(body, ids)
    )

    assert resp.status_code == 404, resp.text
    assert resp.json()["code"].endswith("_NOT_FOUND")


def test_other_store_lists_do_not_include_my_rows(client: TestClient, stores: Stores) -> None:
    base = f"/api/v1/stores/{stores.b}"

    for path in ("/menus", "/ingredients", "/inventory/receipts", "/inventory/counts"):
        assert client.get(f"{base}{path}").json() == [], path
    # 테이블은 매장마다 기본 배치가 자동으로 생기므로 소유 매장만 확인한다
    assert {t["store_id"] for t in client.get(f"{base}/tables").json()} == {stores.b}
    assert client.get(f"{base}/visits").json()["sessions"] == []
    assert client.get(f"{base}/sales-orders").json()["orders"] == []
    assert client.get(f"{base}/integrations/mappings").json() == []


def test_failed_cross_store_writes_leave_owner_data_unchanged(
    client: TestClient, stores: Stores
) -> None:
    base_a = f"/api/v1/stores/{stores.a}"
    before = {
        path: client.get(f"{base_a}{path}").json()
        for path in (
            f"/menus/{stores.menu}",
            f"/ingredients/{stores.ingredient}",
            "/tables",
            "/sales-orders",
        )
    }

    ids = vars(stores)
    for method, path, body in CROSS_STORE_CALLS:
        client.request(
            method, f"/api/v1/stores/{stores.b}{_fill(path, ids)}", json=_fill(body, ids)
        )

    for path, expected in before.items():
        assert client.get(f"{base_a}{path}").json() == expected, path


def test_unknown_store_is_not_found(client: TestClient) -> None:
    resp = client.get("/api/v1/stores/00000000-0000-0000-0000-000000000000/menus")

    assert resp.status_code == 404
    assert resp.json()["code"] == "STORE_NOT_FOUND"
