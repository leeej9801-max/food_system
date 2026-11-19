"""월별 손익표 (WO-20261111-002)."""

import json
from datetime import UTC, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models import AuditEvent, InventoryReceipt, MonthlyGoal, utcnow

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


def test_kpi_counts_orders_once_and_compares_full_days(client: TestClient) -> None:
    # 서울 11/1 10시. 어제 저녁과 오늘 늦게 수집된 기록도 시각 cutoff 없이 포함한다.
    client.app.dependency_overrides[utcnow] = lambda: datetime(2026, 11, 1, 1, tzinfo=UTC)  # type: ignore[attr-defined]
    sid = _store(client)
    _sell(
        client,
        sid,
        "K1,2026-10-31 14:50:00,a,2,1000,COMPLETED\n"
        "K1,2026-10-31 14:50:00,b,1,500,COMPLETED\n"
        "K2,2026-10-31 15:10:00,a,1,3000,COMPLETED\n"
        "K3,2026-11-01 14:50:00,a,1,4000,COMPLETED\n"
        "K4,2026-11-01 03:00:00,a,1,9999,CANCELLED\n"
        "K5,2026-11-02 03:00:00,a,1,5000,COMPLETED\n",
    )
    other = _store(client)
    _sell(client, other, "K9,2026-11-01 03:00:00,a,1,8888,COMPLETED\n")
    body = client.get(f"/api/v1/stores/{sid}/pnl", params={"month": "2026-11"}).json()
    assert body["kpi"] == {
        "order_count": 3,
        "previous_order_count": 1,
        "to_date_order_count": 2,
        "previous_to_date_order_count": 0,
        "previous_has_data": True,
        "previous_to_date_has_data": False,
        "today": {"date": "2026-11-01", "revenue": 7000, "order_count": 2},
        "yesterday": {"date": "2026-10-31", "revenue": 2500, "order_count": 1},
    }


def test_kpi_manual_revenue_does_not_invent_orders(client: TestClient) -> None:
    sid = _store(client)
    body = client.put(
        f"/api/v1/stores/{sid}/pnl/2024-02/expenses",
        json={"items": [{"code": "revenue", "amount": 100000}]},
    ).json()
    assert body["revenue"]["amount"] == 100000
    assert body["kpi"]["order_count"] == 0
    assert body["kpi"]["previous_has_data"] is False
    assert body["kpi"]["to_date_order_count"] is None
    # 기록된 0원 월과 아예 기록이 없는 월을 구분한다.
    client.put(
        f"/api/v1/stores/{sid}/pnl/2024-02/expenses",
        json={"items": [{"code": "revenue", "amount": 0}]},
    )
    march = client.get(f"/api/v1/stores/{sid}/pnl", params={"month": "2024-03"}).json()
    assert march["kpi"]["previous_has_data"] is True


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
    days = {d["date"]: d for d in oct_["daily"]}
    assert len(days) == 31
    assert days["2026-10-31"] == {"date": "2026-10-31", "revenue": 20_000, "expenses": 400}
    assert days["2026-10-20"] == {"date": "2026-10-20", "revenue": 0, "expenses": 7_001}
    assert sum(d["revenue"] for d in oct_["daily"]) == 20_000

    nov = client.get(f"/api/v1/stores/{sid}/pnl", params={"month": "2026-11"}).json()
    assert nov["revenue"]["amount"] == 5_005
    assert _line(nov, "card_fee")["amount"] == 100  # 100.1 → 100
    assert nov["daily"][0] == {"date": "2026-11-01", "revenue": 5_005, "expenses": 100}
    assert len(nov["daily"]) == 30

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


def test_comparison_full_month_and_dated_to_date(client: TestClient, db_session: Session) -> None:
    client.app.dependency_overrides[utcnow] = lambda: datetime(2026, 3, 15, tzinfo=UTC)  # type: ignore[attr-defined]
    sid = _store(client)
    base = f"/api/v1/stores/{sid}/pnl"
    _sell(
        client,
        sid,
        "P1,2026-02-15 03:00:00,a,1,1000,COMPLETED\n"
        "P2,2026-02-16 03:00:00,a,1,2000,COMPLETED\n"
        "C1,2026-03-15 03:00:00,a,1,3000,COMPLETED\n"
        "C2,2026-03-16 03:00:00,a,1,4000,COMPLETED\n"
        "C3,2026-03-15 04:00:00,a,1,5000,CANCELLED\n",
    )
    ing = client.post(
        f"/api/v1/stores/{sid}/ingredients",
        json={"name": "면", "base_unit": "g", "purchase_unit": "kg", "conversion_factor": "1000"},
    ).json()
    for month, day, cost in [(2, 15, "500.50"), (3, 15, "7000.50"), (3, 16, "9000")]:
        receipt = client.post(
            f"/api/v1/stores/{sid}/inventory/receipts",
            json={"ingredient_id": ing["id"], "purchase_quantity": "1", "total_cost": cost},
        )
        assert receipt.status_code == 201, receipt.text
        db_session.execute(
            update(InventoryReceipt)
            .where(InventoryReceipt.id == UUID(receipt.json()["id"]))
            .values(received_at=datetime(2026, month, day, 3, tzinfo=UTC))
        )
        db_session.commit()
    previous = client.put(
        f"{base}/2026-02/expenses",
        json={"items": [{"code": "rent", "amount": 333}, {"code": "ingredients", "amount": 8000}]},
    ).json()
    # 지난달 전체는 수기 비용과 자동 매출·카드수수료를 함께 쓴다.
    assert previous["total_expenses"] == 8393
    body = client.put(
        f"{base}/2026-03/expenses",
        json={"items": [{"code": "revenue", "amount": 99999}, {"code": "card_fee", "amount": 1}]},
    ).json()
    comparison = body["comparison"]
    assert (
        comparison["previous_month"]
        == body["trend"][-2]
        == {"month": "2026-02", "revenue": 3000, "total_expenses": 8393, "operating_profit": -5393}
    )
    assert comparison["to_date"] == {
        "start": "2026-03-01",
        "end": "2026-03-15",
        "revenue": 3000,
        "expenses": 7061,
        "operating_profit": -4061,
    }
    assert comparison["previous_to_date"] == {
        "start": "2026-02-01",
        "end": "2026-02-15",
        "revenue": 1000,
        "expenses": 521,
        "operating_profit": 479,
    }
    assert comparison["to_date"]["expenses"] == sum(d["expenses"] for d in body["daily"][:15])
    for month in ("2026-02", "2026-04"):
        comparison = client.get(base, params={"month": month}).json()["comparison"]
        assert comparison["to_date"] is None
        assert comparison["previous_to_date"] is None


@pytest.mark.parametrize(
    ("now", "month", "previous_end"),
    [
        (datetime(2024, 3, 31, tzinfo=UTC), "2024-03", "2024-02-29"),
        (datetime(2026, 3, 31, tzinfo=UTC), "2026-03", "2026-02-28"),
        (datetime(2026, 1, 31, tzinfo=UTC), "2026-01", "2025-12-31"),
    ],
)
def test_comparison_clamps_previous_month(
    client: TestClient, now: datetime, month: str, previous_end: str
) -> None:
    client.app.dependency_overrides[utcnow] = lambda: now  # type: ignore[attr-defined]
    sid = _store(client)
    body = client.get(f"/api/v1/stores/{sid}/pnl", params={"month": month}).json()
    period = body["comparison"]["previous_to_date"]
    assert period == {
        "start": previous_end[:7] + "-01",
        "end": previous_end,
        "revenue": 0,
        "expenses": 0,
        "operating_profit": 0,
    }
    assert body["comparison"]["to_date"]["end"] == month + "-31"


@pytest.mark.parametrize(
    ("timezone", "month", "end"),
    [
        ("Asia/Seoul", "2026-11", "2026-11-01"),
        ("UTC", "2026-10", "2026-10-31"),
    ],
)
def test_comparison_uses_store_current_month(
    client: TestClient, timezone: str, month: str, end: str
) -> None:
    client.app.dependency_overrides[utcnow] = lambda: datetime(2026, 10, 31, 15, 30, tzinfo=UTC)  # type: ignore[attr-defined]
    sid = client.post("/api/v1/stores", json={"name": "timezone", "timezone": timezone}).json()[
        "id"
    ]
    _sell(client, sid, "T1,2026-10-31 15:15:00,a,1,100,COMPLETED\n")
    body = client.get(f"/api/v1/stores/{sid}/pnl", params={"month": month}).json()
    assert body["comparison"]["to_date"] == {
        "start": month + "-01",
        "end": end,
        "revenue": 100,
        "expenses": 2,
        "operating_profit": 98,
    }


def test_goal_roundtrip_and_audit(client: TestClient, db_session: Session) -> None:
    client.app.dependency_overrides[utcnow] = lambda: datetime(2026, 3, 15, tzinfo=UTC)  # type: ignore[attr-defined]
    sid = _store(client)
    base = f"/api/v1/stores/{sid}/pnl"
    empty = {"revenue_target": None, "profit_target": None}
    assert client.get(base, params={"month": "2026-03"}).json()["goal"]["revenue_target"] is None
    for payload in (
        {"revenue_target": 10_000_000_000, "profit_target": -10_000_000_000},
        {"revenue_target": 0, "profit_target": 10_000_000_000},
        {"profit_target": 0},
        empty,
    ):
        saved = client.put(f"{base}/2026-03/goal", json=payload)
        assert saved.status_code == 200, saved.text
        assert {key: saved.json()["goal"][key] for key in empty} == {**empty, **payload}
        assert saved.json() == client.get(base, params={"month": "2026-03"}).json()
    assert client.get(base, params={"month": "2026-02"}).json()["goal"]["profit_target"] is None
    goals = db_session.scalars(select(MonthlyGoal)).all()
    assert len(goals) == 1
    assert goals[0].updated_at >= goals[0].created_at
    audits = db_session.scalars(
        select(AuditEvent).where(AuditEvent.entity_type == "monthly_goal")
    ).all()
    assert len(audits) == 4
    assert all(a.entity_id == goals[0].id and a.store_id == UUID(sid) for a in audits)
    assert all(json.loads(a.change_summary)["month"] == "2026-03" for a in audits)


@pytest.mark.parametrize(
    "payload",
    [
        {"revenue_target": -1},
        {"revenue_target": 10_000_000_001},
        {"profit_target": -10_000_000_001},
        {"profit_target": 10_000_000_001},
        {"revenue_target": "bad"},
        {"profit_target": 1.5},
    ],
)
def test_goal_validation(client: TestClient, payload: dict) -> None:
    sid = _store(client)
    response = client.put(f"/api/v1/stores/{sid}/pnl/2026-03/goal", json=payload)
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")


def test_goal_month_and_store_validation(client: TestClient) -> None:
    sid = _store(client)
    assert client.put(f"/api/v1/stores/{sid}/pnl/2026-13/goal", json={}).status_code == 422
    unknown = "01a1c9c8-50dd-7f9b-947c-e05fac1e3b99"
    assert client.put(f"/api/v1/stores/{unknown}/pnl/2026-03/goal", json={}).status_code == 404


def test_day_detail_groups_sales_and_lists_receipts(
    client: TestClient, db_session: Session
) -> None:
    sid = _store(client)
    # 11-05 03:00 UTC = 매장 12:00. 11-05 16:00 UTC = 11-06 01:00 이라 다음 날.
    _sell(
        client,
        sid,
        "D1,2026-11-05 03:00:00,a,2,10000,COMPLETED\n"
        "D2,2026-11-05 04:00:00,a,1,10000,COMPLETED\n"
        "D3,2026-11-05 05:00:00,b,1,3000,COMPLETED\n"
        "D4,2026-11-05 06:00:00,b,1,3000,CANCELLED\n"
        "D5,2026-11-05 16:00:00,a,1,10000,COMPLETED\n",
    )
    ing = client.post(
        f"/api/v1/stores/{sid}/ingredients",
        json={"name": "면", "base_unit": "g", "purchase_unit": "kg", "conversion_factor": "1000"},
    ).json()
    client.post(
        f"/api/v1/stores/{sid}/inventory/receipts",
        json={"ingredient_id": ing["id"], "purchase_quantity": "2", "total_cost": "5000"},
    )
    db_session.execute(
        update(InventoryReceipt).values(received_at=datetime(2026, 11, 5, 1, tzinfo=UTC))
    )
    db_session.commit()

    r = client.get(f"/api/v1/stores/{sid}/pnl/days/2026-11-05")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [(s["name"], s["quantity"], s["amount"]) for s in body["sales"]] == [
        ("a", 3, 30_000),
        ("b", 1, 3_000),
    ]
    assert body["revenue"] == 33_000
    assert body["card_fee"] == 660  # 기본 2%
    assert [(x["ingredient_name"], x["amount"]) for x in body["receipts"]] == [("면", 5_000)]
    assert body["expenses"] == 5_660
    assert body["operating_profit"] == 27_340

    month = client.get(f"/api/v1/stores/{sid}/pnl", params={"month": "2026-11"}).json()
    day5 = next(d for d in month["daily"] if d["date"] == "2026-11-05")
    assert (day5["revenue"], day5["expenses"]) == (body["revenue"], body["expenses"])

    empty = client.get(f"/api/v1/stores/{sid}/pnl/days/2026-11-04").json()
    assert (empty["sales"], empty["receipts"], empty["revenue"]) == ([], [], 0)
    assert client.get(f"/api/v1/stores/{sid}/pnl/days/2026-13-01").status_code == 422
