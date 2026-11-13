"""프론트 응답 스키마(frontend/src/api/schemas.ts) 검증용 표본을 만든다 (TS-010).

프론트가 부르는 경로를 실제로 호출해 응답을 모은다. 평소에는 2xx 여부만 본다.
`UPDATE_API_SAMPLES=1 uv run pytest tests/api/test_frontend_samples.py`로
`frontend/src/api/__fixtures__/responses.json`을 다시 쓴다. 프론트 vitest가 이 파일을 스키마로 검증한다.
"""

import json
import os
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

FIXTURE = Path(__file__).parents[3] / "frontend" / "src" / "api" / "__fixtures__" / "responses.json"

CSV_TEXT = """order_id,ordered_at,menu_name,quantity,unit_price,status
S-1,2026-11-01 12:10:00,없는메뉴,2,9000,COMPLETED
S-2,2026-11-01,없는메뉴,1,9000,CANCELLED
S-3,bad-date,,x,9000,COMPLETED
"""


def test_collect_frontend_response_samples(client: TestClient) -> None:
    samples: dict[str, list[Any]] = {}

    def call(schema: str, method: str, path: str, body: Any = None, unwrap: bool = False) -> Any:
        resp = client.request(method, f"/api/v1{path}", json=body)
        assert resp.status_code < 300, f"{method} {path}: {resp.status_code} {resp.text}"
        data = resp.json()
        samples.setdefault(schema, []).extend(data if unwrap else [data])
        return data

    store = call("storeSchema", "POST", "/stores", {"name": "표본 매장"})
    s = f"/stores/{store['id']}"
    call(
        "storeSchema",
        "PATCH",
        s,
        {
            "floor_fixtures": [
                {"kind": "COUNTER", "x": 0, "y": 0, "w": 2, "h": 1, "label": "계산대"}
            ]
        },
    )
    call("storeSchema", "GET", "/stores", unwrap=True)
    call("seedResultSchema", "POST", f"{s}/seed-western-demo")

    table = call("storeTableSchema", "POST", f"{s}/tables", {"name": "T1", "seats": 4})
    visit = call(
        "visitSessionSchema",
        "POST",
        f"{s}/visits",
        {"table_id": table["id"], "party_size": 2, "age_band": "20S"},
    )
    call(
        "visitSessionSchema",
        "PATCH",
        f"{s}/visits/{visit['id']}/slots/1",
        {"gender": "FEMALE", "age_band": "30S"},
    )
    call("storeTableSchema", "GET", f"{s}/tables", unwrap=True)
    call("visitSummarySchema", "GET", f"{s}/visits")

    menus = call("menuItemSchema", "GET", f"{s}/menus", unwrap=True)
    ingredients = call("ingredientSchema", "GET", f"{s}/ingredients", unwrap=True)
    menu_id, ingredient_id = menus[0]["id"], ingredients[0]["id"]
    call("recipeDetailSchema", "GET", f"{s}/menus/{menu_id}/recipe")
    call("ingredientUsageSchema", "GET", f"{s}/ingredients/{ingredient_id}/usages", unwrap=True)

    call("integrationStatusSchema", "GET", f"{s}/integrations/status")
    call("sampleCsvSchema", "GET", f"{s}/imports/sales-csv/sample")
    preview = call(
        "csvPreviewSchema",
        "POST",
        f"{s}/imports/sales-csv/preview",
        {"file_name": "sample.csv", "csv_text": CSV_TEXT},
    )
    call("csvCommitSchema", "POST", f"{s}/imports/sales-csv/{preview['batch_id']}/commit")
    call(
        "productMappingSchema",
        "POST",
        f"{s}/integrations/mappings",
        {"external_product_name": "없는메뉴", "menu_item_id": menu_id},
    )
    call("productMappingSchema", "GET", f"{s}/integrations/mappings", unwrap=True)
    # 목록의 주문을 표본으로 쓴다
    orders = call("salesOrdersListSchema", "GET", f"{s}/sales-orders")["orders"]
    samples["salesOrderSchema"] = orders
    call("integrationStatusSchema", "GET", f"{s}/integrations/status")

    call(
        "inventoryReceiptSchema",
        "POST",
        f"{s}/inventory/receipts",
        {"ingredient_id": ingredient_id, "purchase_quantity": 1, "total_cost": 10000},
    )
    call("inventoryReceiptSchema", "GET", f"{s}/inventory/receipts", unwrap=True)
    call(
        "inventoryCountSchema",
        "POST",
        f"{s}/inventory/counts",
        {"ingredient_id": ingredient_id, "actual_quantity": 500},
    )
    call("inventoryCountSchema", "GET", f"{s}/inventory/counts", unwrap=True)
    call(
        "inventoryAdjustmentSchema",
        "POST",
        f"{s}/inventory/adjustments",
        {"ingredient_id": ingredient_id, "quantity_delta": -10, "reason": "WASTE"},
    )
    call("inventoryItemSchema", "GET", f"{s}/inventory/summary?include_inactive=true", unwrap=True)

    call("salesAnalyticsSchema", "GET", f"{s}/analytics/sales")
    call("costSimulationSchema", "POST", f"{s}/analytics/costing", {"global_change_percent": 10})
    call(
        "pnlSchema",
        "PUT",
        f"{s}/pnl/2026-10/expenses",
        {"items": [{"code": "rent", "amount": 1000}]},
    )

    problem = client.post("/api/v1/stores", json={})
    assert problem.status_code == 422
    samples["problemSchema"] = [problem.json()]

    assert all(samples.values()), [name for name, rows in samples.items() if not rows]

    if os.environ.get("UPDATE_API_SAMPLES"):
        FIXTURE.parent.mkdir(exist_ok=True)
        FIXTURE.write_text(
            json.dumps(samples, ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8",
            newline="\n",
        )
