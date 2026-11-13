"""월별 손익표 (WO-20261111-002)."""

from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db.models import InventoryReceipt

# 사장님 엑셀 "약식 손익계산" 예시 (총매출 38,000,000원)
EXCEL = {
    "rent": 5_100_000,
    "liquor": 1_000_000,
    "ingredients": 12_000_000,
    "building": 243_800,
    "labor": 7_000_000,
    "social_insurance": 834_000,
    "electricity": 700_000,
    "water": 235_000,
    "gas": 300_000,
    "water_purifier": 33_000,
    "security": 100_000,
    "internet": 46_000,
    "bookkeeping": 200_000,
    "advertising": 600_000,
    "vat": 2_000_000,
    "fire_insurance": 20_000,
    "card_fee": 900_000,
}


def _store(client: TestClient) -> str:
    return client.post("/api/v1/stores", json={"name": "pnl test"}).json()["id"]


def _sell(client: TestClient, sid: str, rows: str) -> None:
    csv_text = "order_id,ordered_at,menu_name,quantity,unit_price,status\n" + rows
    preview = client.post(
        f"/api/v1/stores/{sid}/imports/sales-csv/preview",
        json={"file_name": "s.csv", "csv_text": csv_text},
    ).json()
    r = client.post(f"/api/v1/stores/{sid}/imports/sales-csv/{preview['batch_id']}/commit")
    assert r.status_code == 200, r.text


def _line(body: dict, code: str) -> dict:
    return next(x for x in body["expenses"] if x["code"] == code)


def test_excel_example_totals(client: TestClient) -> None:
    sid = _store(client)
    _sell(client, sid, "A1,2026-10-15 12:00:00,big,1,38000000,COMPLETED\n")
    items = [{"code": k, "amount": v} for k, v in EXCEL.items()]
    r = client.put(f"/api/v1/stores/{sid}/pnl/2026-10/expenses", json={"items": items})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["revenue"]["amount"] == 38_000_000
    assert body["total_expenses"] == 31_311_800
    assert body["operating_profit"] == 6_688_200
    assert body["operating_margin_percent"] == "17.6"
    assert _line(body, "rent")["ratio_percent"] == "13.4"
    assert _line(body, "card_fee")["source"] == "manual"
    assert [p["month"] for p in body["trend"]] == [
        "2026-05",
        "2026-06",
        "2026-07",
        "2026-08",
        "2026-09",
        "2026-10",
    ]
    assert body["trend"][-1]["operating_profit"] == 6_688_200


def test_auto_items_and_month_boundary(client: TestClient, db_session: Session) -> None:
    sid = _store(client)
    # 취소 품목은 매출에서 뺀다. CSV 시각은 UTC로 읽힌다(imports.py). 10-31 15:30 UTC는
    # 매장 시간대(Asia/Seoul)로 11-01 00:30이라 11월이다.
    _sell(
        client,
        sid,
        "B1,2026-10-31 14:30:00,a,2,10000,COMPLETED\n"
        "B2,2026-10-31 14:40:00,a,1,10000,CANCELLED\n"
        "B3,2026-10-31 15:30:00,a,1,5005,COMPLETED\n",
    )
    ing = client.post(
        f"/api/v1/stores/{sid}/ingredients",
        json={"name": "면", "base_unit": "g", "purchase_unit": "kg", "conversion_factor": "1000"},
    ).json()
    client.post(
        f"/api/v1/stores/{sid}/inventory/receipts",
        json={"ingredient_id": ing["id"], "purchase_quantity": "1", "total_cost": "7000.50"},
    )
    db_session.execute(
        update(InventoryReceipt).values(received_at=datetime(2026, 10, 20, 3, tzinfo=UTC))
    )
    db_session.commit()

    oct_ = client.get(f"/api/v1/stores/{sid}/pnl", params={"month": "2026-10"}).json()
    assert oct_["revenue"] == {
        "code": "revenue",
        "label": "총매출",
        "amount": 20_000,
        "source": "auto",
        "ratio_percent": "100.0",
    }
    assert _line(oct_, "ingredients")["amount"] == 7_001  # 원 단위 반올림
    assert _line(oct_, "card_fee")["amount"] == 400  # 20,000 × 2%
    assert _line(oct_, "rent") == {
        "code": "rent",
        "label": "임대료(부가세 포함)",
        "amount": 0,
        "source": "manual",
        "ratio_percent": "0.0",
    }
    assert oct_["operating_profit"] == 20_000 - 7_001 - 400

    nov = client.get(f"/api/v1/stores/{sid}/pnl", params={"month": "2026-11"}).json()
    assert nov["revenue"]["amount"] == 5_005
    assert _line(nov, "card_fee")["amount"] == 100  # 100.1 → 100

    # 수기 값은 자동 값을 덮어쓰고, 비우면 다시 자동 값이 된다. 수수료율도 바꿀 수 있다.
    r = client.put(
        f"/api/v1/stores/{sid}/pnl/2026-10/expenses",
        json={
            "items": [
                {"code": "ingredients", "amount": 9000},
                {"code": "other", "label": "소모품", "amount": 1000},
            ],
            "card_fee_percent": "1.5",
        },
    ).json()
    assert _line(r, "ingredients")["source"] == "manual"
    assert _line(r, "ingredients")["amount"] == 9000
    assert _line(r, "other")["label"] == "소모품"
    assert _line(r, "card_fee")["amount"] == 300
    assert r["card_fee_percent"] == "1.50"
    r = client.put(f"/api/v1/stores/{sid}/pnl/2026-10/expenses", json={"items": []}).json()
    assert _line(r, "ingredients")["source"] == "auto"
    assert all(x["code"] != "other" for x in r["expenses"])


def test_zero_revenue_and_loss(client: TestClient) -> None:
    sid = _store(client)
    r = client.put(
        f"/api/v1/stores/{sid}/pnl/2026-09/expenses",
        json={"items": [{"code": "rent", "amount": 1000}]},
    ).json()
    assert r["revenue"]["amount"] == 0
    assert r["revenue"]["ratio_percent"] is None
    assert r["operating_profit"] == -1000
    assert r["operating_margin_percent"] is None


def test_validation(client: TestClient) -> None:
    sid = _store(client)
    base = f"/api/v1/stores/{sid}/pnl"
    assert client.get(base, params={"month": "2026-13"}).status_code == 422
    assert client.get(base).status_code == 422
    put = f"{base}/2026-10/expenses"
    for items in (
        [{"code": "nope", "amount": 1}],
        [{"code": "rent", "amount": 1}, {"code": "rent", "amount": 2}],
        [{"code": "other", "amount": 1}],
        [{"code": "rent", "amount": -1}],
    ):
        r = client.put(put, json={"items": items})
        assert r.status_code == 422, items
        assert r.headers["content-type"].startswith("application/problem+json")
    assert client.put(put, json={"items": [], "card_fee_percent": "11"}).status_code == 422
    unknown = "/api/v1/stores/01a1c9c8-50dd-7f9b-947c-e05fac1e3b99/pnl"
    assert client.get(unknown, params={"month": "2026-10"}).status_code == 404


def test_store_isolation(client: TestClient) -> None:
    a, b = _store(client), _store(client)
    client.put(
        f"/api/v1/stores/{a}/pnl/2026-10/expenses", json={"items": [{"code": "rent", "amount": 5}]}
    )
    body = client.get(f"/api/v1/stores/{b}/pnl", params={"month": "2026-10"}).json()
    assert _line(body, "rent")["amount"] == 0
