"""손님 객층·날씨 분석 (WO-20261116-002)."""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import SalesOrder, SalesOrderItem, VisitSession, WeatherDaily
from app.services.guest_analytics import temp_band

STATION = "999"


def _utc(h: int, m: int = 0) -> datetime:
    # 2026-11-10 KST h:m → UTC
    return datetime(2026, 11, 10, h - 9, m, tzinfo=UTC)


def _order(store_id: UUID, ext: str, at: datetime | None, name: str, qty: int) -> SalesOrder:
    order = SalesOrder(
        store_id=store_id,
        external_order_id=ext,
        ordered_at=at,
        time_basis="order_time" if at else "unknown",
    )
    order.items.append(
        SalesOrderItem(
            store_id=store_id, raw_product_name=name, quantity=qty, unit_price=Decimal("10000")
        )
    )
    return order


def test_guest_profile_matching_and_weather(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "kma_station_id", STATION)
    store = client.post(
        "/api/v1/stores", json={"name": "객층 분석", "initial_table_count": 2}
    ).json()
    sid = store["id"]
    tables = client.get(f"/api/v1/stores/{sid}/tables").json()
    visits = f"/api/v1/stores/{sid}/visits"

    a = client.post(visits, json={"table_id": tables[0]["id"]}).json()
    client.post(f"{visits}/{a['id']}/slots", json={"gender": "MALE", "age_band": "30S"})
    client.post(f"{visits}/{a['id']}/slots", json={"gender": "FEMALE", "age_band": "30S"})
    client.patch(f"{visits}/{a['id']}", json={"relationship": "COUPLE"})
    b = client.post(visits, json={"table_id": tables[1]["id"]}).json()
    client.post(f"{visits}/{b['id']}/slots", json={"gender": "FEMALE", "age_band": "20S"})
    client.post(f"{visits}/{b['id']}/slots", json={"gender": "FEMALE", "age_band": "20S"})
    client.post(f"{visits}/{b['id']}/slots", json={"gender": "UNRECORDED", "age_band": "20S"})
    client.patch(f"{visits}/{b['id']}", json={"relationship": "FRIENDS"})

    # 착석 시각을 과거로 옮긴다: A 12:00–13:00, B 12:30–14:00 (KST)
    for vid, start, end in ((a["id"], _utc(12), _utc(13)), (b["id"], _utc(12, 30), _utc(14))):
        v = db_session.get(VisitSession, UUID(vid))
        assert v is not None
        v.seated_at, v.left_at, v.status = start, end, "LEFT"
    store_id = UUID(sid)
    db_session.add_all(
        [
            _order(store_id, "o1", _utc(12, 15), "파스타", 2),  # A만
            _order(store_id, "o2", _utc(12, 45), "피자", 1),  # A·B 겹침 → 모호
            _order(store_id, "o3", _utc(13, 30), "샐러드", 3),  # B만
            _order(store_id, "o4", None, "콜라", 1),  # 시각 없음 → 미연결
            WeatherDaily(
                station_id=STATION,
                weather_date=date(2026, 11, 10),
                avg_temp=Decimal("10.0"),
                precipitation_mm=Decimal("5.0"),
            ),
        ]
    )
    db_session.commit()

    r = client.get(f"/api/v1/stores/{sid}/analytics/guests")
    assert r.status_code == 200
    data = r.json()

    assert (data["visit_count"], data["guest_count"], data["profiled_person_count"]) == (2, 5, 5)
    assert data["avg_stay_minutes"] == 75
    assert {x["key"]: x["count"] for x in data["age_bands"]} == {"20S": 3, "30S": 2}
    assert {x["key"]: x["count"] for x in data["genders"]} == {"FEMALE": 3, "MALE": 1}
    assert {x["key"]: x["count"] for x in data["relationships"]} == {"COUPLE": 1, "FRIENDS": 1}
    assert [(x["key"], x["count"]) for x in data["party_sizes"]] == [("2", 1), ("3", 1)]

    counts = (
        data["matched_order_count"],
        data["ambiguous_order_count"],
        data["unmatched_order_count"],
    )
    assert counts == (2, 1, 1)
    by_rel = {x["key"]: x for x in data["menu_by_relationship"]}
    assert by_rel["COUPLE"]["top_menus"] == [{"menu_name": "파스타", "quantity": 2}]
    assert by_rel["FRIENDS"]["top_menus"] == [{"menu_name": "샐러드", "quantity": 3}]
    by_age = {x["key"]: x["visit_count"] for x in data["menu_by_age_band"]}
    assert by_age == {"30S": 1, "20S": 1}

    assert data["weather_station_configured"] is True
    [day] = data["weather_days"]
    assert (day["day"], Decimal(day["net_sales"]), day["guest_count"]) == (
        "2026-11-10",
        Decimal("60000"),
        5,
    )
    groups = {g["key"]: g for g in data["weather_groups"]}
    assert set(groups) == {"RAIN", "COOL"}
    assert groups["RAIN"]["day_count"] == 1
    assert groups["RAIN"]["top_menus"][0] == {"menu_name": "샐러드", "quantity": 3}


def test_guest_analytics_without_station(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "kma_station_id", "")
    sid = client.post("/api/v1/stores", json={"name": "빈 매장"}).json()["id"]
    data = client.get(f"/api/v1/stores/{sid}/analytics/guests").json()
    assert data["visit_count"] == 0
    assert data["weather_station_configured"] is False
    assert data["weather_days"] == [] and data["weather_groups"] == []


def test_temp_band_edges() -> None:
    assert temp_band(Decimal("4.9")) == "COLD"
    assert temp_band(Decimal("5")) == "COOL"
    assert temp_band(Decimal("24.9")) == "MILD"
    assert temp_band(Decimal("25")) == "HOT"
