"""기본/월 목표, 완료 기간 평균과 전 화면 공통 샘플의 회귀 증명."""

import json
from datetime import UTC, date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    InventoryCount,
    InventoryReceipt,
    MonthlyExpense,
    SalesOrder,
    SessionSlot,
    Store,
    StoreTable,
    VisitSession,
    utcnow,
)
from app.db.models.attendance import AttendanceShift, Staff
from app.services.demo_seed import SAMPLE, seed_western_bistro_demo
from app.services.floor import PRESETS
from app.services.pnl import get_pnl


def test_monthly_goal_carries_over_and_store_isolation(client: TestClient) -> None:
    sid = client.post("/api/v1/stores", json={"name": "목표"}).json()["id"]
    other = client.post("/api/v1/stores", json={"name": "다른 매장"}).json()["id"]
    base = f"/api/v1/stores/{sid}/pnl"
    saved = client.put(
        f"{base}/2026-11/goal", json={"revenue_target": 25000000, "profit_target": 4000000}
    )
    assert saved.status_code == 200, saved.text
    goal = saved.json()["goal"]
    assert goal["revenue_target"] == 25000000 and goal["inherited_from"] is None
    # 12월은 설정하지 않았으므로 11월 목표를 이어받는다
    goal = client.get(base, params={"month": "2026-12"}).json()["goal"]
    assert goal["revenue_target"] == 25000000 and goal["inherited_from"] == "2026-11"
    # 이전 달에는 이어받지 않는다
    assert client.get(base, params={"month": "2026-10"}).json()["goal"]["revenue_target"] is None
    goal = client.put(f"{base}/2026-12/goal", json={"revenue_target": 30000000}).json()["goal"]
    assert goal["revenue_target"] == 30000000 and goal["profit_target"] is None
    assert goal["inherited_from"] is None
    assert (
        client.get(f"/api/v1/stores/{other}/pnl", params={"month": "2026-11"}).json()["goal"][
            "revenue_target"
        ]
        is None
    )


def test_week_and_month_average_boundaries(client: TestClient) -> None:
    client.app.dependency_overrides[utcnow] = lambda: datetime(2026, 11, 18, tzinfo=UTC)  # type: ignore[attr-defined]
    sid = client.post("/api/v1/stores", json={"name": "계산", "timezone": "Asia/Seoul"}).json()[
        "id"
    ]
    base = f"/api/v1/stores/{sid}/pnl"
    # 매일 1,000원 매출, 300원 고정비 + 20원 수수료. 월별 달력 일수를 정확히 안분한다.
    for month, days in (("2026-08", 31), ("2026-09", 30), ("2026-10", 31), ("2026-11", 30)):
        client.put(
            f"{base}/{month}/expenses",
            json={
                "items": [
                    {"code": "revenue", "amount": days * 1000},
                    {"code": "rent", "amount": days * 300},
                ]
            },
        )
    cmp = client.get(base, params={"month": "2026-11"}).json()["comparison"]
    week = cmp["weekly"]
    assert week["current"] == {
        "start": "2026-11-16",
        "end": "2026-11-18",
        "revenue": 3000,
        "expenses": 960,
        "operating_profit": 2040,
    }
    assert week["baseline"]["start"] == "2026-11-09"
    assert week["baseline"]["revenue"] == 3000
    assert cmp["weekly_average"]["baseline"]["revenue"] == 7000
    assert cmp["weekly_average"]["baseline"]["expenses"] == 2240
    assert cmp["monthly_average"]["baseline"]["revenue"] == 30667
    assert cmp["monthly_average"]["baseline_count"] == 3
    assert (
        client.get(base, params={"month": "2026-11", "average_months": 1}).json()["comparison"][
            "monthly_average"
        ]["baseline"]["revenue"]
        == 31000
    )
    assert client.get(base, params={"month": "2026-11", "average_months": 0}).status_code == 422
    assert (
        client.get(base, params={"month": "2027-01"}).json()["comparison"]["weekly"]["current"]
        is None
    )
    # 누락된 완료월을 0원으로 평균내지 않는다.
    client.put(f"{base}/2026-09/expenses", json={"items": []})
    assert (
        client.get(base, params={"month": "2026-11"}).json()["comparison"]["monthly_average"][
            "baseline"
        ]
        is None
    )


def test_sample_period_ratios_and_replace_preserves_manual(db_session: Session) -> None:
    store = Store(name="샘플 검증", business_days="화,수,목,금,토,일")
    db_session.add(store)
    db_session.commit()
    sid = store.id
    seed_western_bistro_demo(db_session, store_id=sid, today=date(2026, 11, 18))
    tables, fixtures = PRESETS["meal_love"]
    assert json.loads(store.floor_fixtures or "null") == list(fixtures)
    assert db_session.scalar(select(func.count()).select_from(StoreTable)) == len(tables)
    staff = list(db_session.scalars(select(Staff).where(Staff.store_id == sid)))
    assert len(staff) == 5
    assert {row.role for row in staff} == {"HALL", "KITCHEN"}
    shift_ids = set(
        db_session.scalars(select(AttendanceShift.id).where(AttendanceShift.store_id == sid))
    )
    assert len(shift_ids) >= 185
    manual_staff = Staff(store_id=sid, name="수기 직원", role="HALL", color="#123456")
    db_session.add(manual_staff)
    totals = []
    for number in range(5, 12):
        pnl = get_pnl(
            db_session,
            store_id=sid,
            month=f"2026-{number:02}",
            now=datetime(2026, 11, 18, tzinfo=UTC),
        )
        ingredients = next(line.amount for line in pnl.expenses if line.code == "ingredients")
        assert Decimal("0.30") <= Decimal(ingredients) / pnl.revenue.amount <= Decimal("0.35")
        assert Decimal(10) <= pnl.operating_margin_percent <= Decimal(20)  # type: ignore[operator]
        totals.append((pnl.revenue.amount, pnl.total_expenses))
    orders = db_session.scalar(select(func.count()).select_from(SalesOrder))
    assert orders is not None
    assert orders == db_session.scalar(select(func.count()).select_from(VisitSession))
    slots = db_session.scalar(select(func.count()).select_from(SessionSlot))
    assert slots is not None and slots > orders
    bounds = db_session.execute(
        select(func.min(SalesOrder.ordered_at), func.max(SalesOrder.ordered_at))
    ).one()
    first_at, last_at = bounds
    assert first_at is not None and last_at is not None
    assert first_at.date() == date(2026, 5, 1)
    assert last_at.date() == date(2026, 11, 18)
    assert all(
        row.ordered_at is not None
        and row.ordered_at.astimezone(ZoneInfo("Asia/Seoul")).weekday() != 0
        for row in db_session.scalars(select(SalesOrder))
    )
    ing = db_session.scalar(select(InventoryReceipt.ingredient_id))
    count = InventoryCount(
        store_id=sid, ingredient_id=ing, actual_quantity=123, base_unit="g", notes="사용자 입력"
    )
    expense = MonthlyExpense(
        store_id=sid, month="2026-11", item_code="other", label="사용자 입력", amount=100
    )
    db_session.add_all([count, expense])
    db_session.commit()
    seed_western_bistro_demo(db_session, store_id=sid, today=date(2026, 11, 18))
    assert db_session.get(Staff, manual_staff.id) is not None
    assert db_session.scalar(select(func.count()).select_from(Staff)) == 6
    assert set(db_session.scalars(select(AttendanceShift.id))) == shift_ids
    assert db_session.scalar(select(func.count()).select_from(StoreTable)) == len(tables)
    assert db_session.get(InventoryCount, count.id) is not None
    assert db_session.get(MonthlyExpense, expense.id) is not None
    assert (
        db_session.scalar(
            select(func.count()).select_from(SalesOrder).where(SalesOrder.source_mode == SAMPLE)
        )
        == orders
    )
    for number, (revenue, expenses) in zip(range(5, 12), totals, strict=True):
        pnl = get_pnl(db_session, store_id=sid, month=f"2026-{number:02}")
        assert (pnl.revenue.amount, pnl.total_expenses) == (
            revenue,
            expenses + (100 if number == 11 else 0),
        )


def test_week_sales_timezone_and_absent_week(client: TestClient) -> None:
    client.app.dependency_overrides[utcnow] = lambda: datetime(2026, 11, 1, 1, tzinfo=UTC)  # type: ignore[attr-defined]
    sid = client.post("/api/v1/stores", json={"name": "주 경계"}).json()["id"]
    base = f"/api/v1/stores/{sid}"
    preview = client.post(
        f"{base}/imports/sales-csv/preview",
        json={
            "csv_text": "order_id,ordered_at,menu_name,quantity,unit_price,status\nW1,2026-10-31 16:00:00,a,1,10000,COMPLETED\nW2,2026-10-18 03:00:00,a,1,99999,COMPLETED\nW3,2026-10-25 03:00:00,a,1,50000,CANCELLED\n"
        },
    ).json()
    assert client.post(f"{base}/imports/sales-csv/{preview['batch_id']}/commit").status_code == 200
    cmp = client.get(f"{base}/pnl", params={"month": "2026-11"}).json()["comparison"]
    assert cmp["weekly"]["current"] == {
        "start": "2026-10-26",
        "end": "2026-11-01",
        "revenue": 10000,
        "expenses": 200,
        "operating_profit": 9800,
    }
    assert cmp["weekly"]["baseline"] is None  # 같은 달 다른 주의 기록으로 0원 주를 발명하지 않는다.
    assert cmp["weekly_average"]["baseline"] is None
