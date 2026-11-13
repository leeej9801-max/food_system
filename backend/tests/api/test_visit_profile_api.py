"""홀 배치·사람별 객층·방문 맥락·자동 닫기·공휴일 (WO-20261105-001)."""

import uuid
from collections.abc import Generator
from datetime import UTC, date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Store, StoreTable, VisitSession
from app.main import create_app
from app.services.floor import MEAL_LOVE_TABLES, apply_floor_preset
from app.services.holidays import day_type
from app.services.visit_profile import business_close_at, close_expired_sessions

GUEST = "/api/guest/v1/qr"


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest.fixture
def staff(app: FastAPI) -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def phone(app: FastAPI) -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def phone2(app: FastAPI) -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def table(staff: TestClient) -> dict:
    store = staff.post(
        "/api/v1/stores", json={"name": "객층 테스트", "initial_table_count": 2}
    ).json()
    t = staff.get(f"/api/v1/stores/{store['id']}/tables").json()[0]
    token = staff.post(f"/api/v1/stores/{store['id']}/tables/{t['id']}/qr-token").json()["token"]
    return {"store_id": store["id"], "table_id": t["id"], "token": token}


# --- 배치 ---


def test_table_orientation_and_extended_grid(staff: TestClient, table: dict) -> None:
    url = f"/api/v1/stores/{table['store_id']}/tables/{table['table_id']}"
    r = staff.patch(url, json={"grid_x": 27, "grid_y": 23, "orientation": "V"})
    assert r.status_code == 200
    assert (r.json()["grid_x"], r.json()["grid_y"], r.json()["orientation"]) == (27, 23, "V")
    assert staff.patch(url, json={"grid_x": 28}).status_code == 422
    assert staff.patch(url, json={"orientation": "X"}).status_code == 422


def test_floor_preset_is_idempotent(staff: TestClient, db_session: Session, table: dict) -> None:
    sid = table["store_id"]
    first = apply_floor_preset(db_session, sid)
    assert first == {"created": 10, "updated": 2}  # T1·T2는 기존 테이블 재사용
    assert apply_floor_preset(db_session, sid) == {"created": 0, "updated": 0}

    tables = staff.get(f"/api/v1/stores/{sid}/tables").json()
    assert len(tables) == 12
    assert sum(t["orientation"] == "V" for t in tables) == 8
    by_name = {t["name"]: (t["grid_x"], t["grid_y"], t["orientation"], t["seats"]) for t in tables}
    assert by_name == {n: (x, y, o, s) for n, x, y, o, s in MEAL_LOVE_TABLES}
    assert by_name["T7"][3] == by_name["T8"][3] == 2
    kinds = {f["kind"] for f in staff.get(f"/api/v1/stores/{sid}").json()["floor_fixtures"]}
    assert {"ENTRANCE", "COUNTER", "PARTITION", "SOFA", "WAITING"} <= kinds
    assert "KITCHEN" not in kinds


# --- 사람별 성별·연령대 ---


def test_guest_profile_only_on_own_slot_and_staff_cannot_override(
    staff: TestClient, phone: TestClient, phone2: TestClient, table: dict
) -> None:
    base = f"{GUEST}/{table['token']}/session"
    phone.post(base, json={"party_size": 2})
    phone.post(f"{base}/slots/1/claim")

    denied = phone2.patch(f"{base}/slots/1", json={"gender": "MALE"})
    assert denied.status_code == 403
    mine = phone.patch(f"{base}/slots/1", json={"gender": "FEMALE", "age_band": "20S"}).json()
    slot = mine["session"]["slots"][0]
    assert (slot["gender"], slot["age_band"]) == ("FEMALE", "20S")

    visits = f"/api/v1/stores/{table['store_id']}/visits"
    visit = staff.get(f"/api/v1/stores/{table['store_id']}/tables").json()[0]["active_visit"]
    blocked = staff.patch(f"{visits}/{visit['id']}/slots/1", json={"age_band": "30S"})
    assert blocked.json()["code"] == "SLOT_PROFILE_BY_GUEST"

    # 손님이 비워 둔 자리는 직원이 채운다. 섞이면 세션 대표값은 MIXED
    filled = staff.patch(
        f"{visits}/{visit['id']}/slots/2", json={"gender": "MALE", "age_band": "30S"}
    ).json()
    assert filled["slots"][1]["profile_source"] == "STAFF"
    assert filled["age_band"] == "MIXED"
    same = staff.patch(f"{visits}/{visit['id']}/slots/2", json={"age_band": "20S"}).json()
    assert same["age_band"] == "20S"


def test_staff_slot_profile_not_found(staff: TestClient, table: dict) -> None:
    visits = f"/api/v1/stores/{table['store_id']}/visits"
    v = staff.post(visits, json={"table_id": table["table_id"], "party_size": 2}).json()
    assert len(v["slots"]) == 2
    r = staff.patch(f"{visits}/{v['id']}/slots/9", json={"gender": "MALE"})
    assert r.json()["code"] == "SLOT_NOT_FOUND"
    r = staff.patch(f"{visits}/{table['store_id']}/slots/1", json={"gender": "MALE"})
    assert r.json()["code"] == "VISIT_NOT_FOUND"
    # 형식이 틀린 id는 DB까지 가지 않고 422로 끝난다
    r = staff.patch(f"{visits}/nope/slots/1", json={"gender": "MALE"})
    assert r.status_code == 422


# --- 방문 목적·관계 ---


def test_visit_context_guest_wins(staff: TestClient, phone: TestClient, table: dict) -> None:
    visits = f"/api/v1/stores/{table['store_id']}/visits"
    v = staff.post(visits, json={"table_id": table["table_id"], "party_size": 2}).json()
    staffed = staff.patch(f"{visits}/{v['id']}", json={"purpose": "MEAL"}).json()
    assert (staffed["purpose"], staffed["context_source"]) == ("MEAL", "STAFF")

    guest = phone.patch(
        f"{GUEST}/{table['token']}/session", json={"purpose": "DATE", "relationship": "COUPLE"}
    ).json()
    assert (guest["session"]["purpose"], guest["session"]["relationship"]) == ("DATE", "COUPLE")

    blocked = staff.patch(f"{visits}/{v['id']}", json={"purpose": "COMPANY"})
    assert blocked.json()["code"] == "CONTEXT_BY_GUEST"
    # 다른 항목(인원)은 그대로 직원이 고칠 수 있다
    assert staff.patch(f"{visits}/{v['id']}", json={"party_size": 3}).status_code == 200
    assert (
        phone.patch(f"{GUEST}/{table['token']}/session", json={"purpose": "BAD"}).status_code == 422
    )


# --- 자동 닫기 ---


def _seat(db: Session, table: dict, seated_at: datetime) -> VisitSession:
    visit = VisitSession(
        store_id=table["store_id"],
        table_id=table["table_id"],
        party_size=2,
        status="SEATED",
        seated_at=seated_at,
    )
    db.add(visit)
    db.commit()
    return visit


def test_business_close_times() -> None:
    store = Store(name="s", timezone="Asia/Seoul", opening_hours="11:00-21:00")
    # 12:00 KST 착석 → 퇴점 21:00 KST, 닫기는 다음 날 11:00 KST
    close = business_close_at(store, datetime(2026, 11, 5, 3, 0, tzinfo=UTC))
    assert close is not None
    left, run = close
    assert left == datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
    assert run == datetime(2026, 11, 6, 2, 0, tzinfo=UTC)

    overnight = Store(name="s", timezone="Asia/Seoul", opening_hours="17:00-02:00")
    # 01:00 KST(전날 영업) 착석 → 퇴점 02:00 KST 같은 날
    close = business_close_at(overnight, datetime(2026, 11, 4, 16, 0, tzinfo=UTC))
    assert close is not None
    left, run = close
    assert left == datetime(2026, 11, 4, 17, 0, tzinfo=UTC)
    assert run == datetime(2026, 11, 5, 8, 0, tzinfo=UTC)

    for hours in (None, "", "늘 영업", "25:00-10:00"):
        assert business_close_at(Store(name="s", opening_hours=hours), datetime.now(UTC)) is None


def test_auto_close_previous_business_day(
    staff: TestClient, db_session: Session, table: dict
) -> None:
    staff.patch(f"/api/v1/stores/{table['store_id']}", json={"opening_hours": "11:00-21:00"})
    old = _seat(db_session, table, datetime(2026, 11, 3, 5, 0, tzinfo=UTC))  # 11/3 14:00 KST

    # 같은 날 밤(종료 후, 다음 영업 전)에는 닫지 않는다
    assert (
        close_expired_sessions(
            db_session, table["store_id"], datetime(2026, 11, 3, 14, 0, tzinfo=UTC)
        )
        == 0
    )
    assert old.status == "SEATED"

    staff.get(f"/api/v1/stores/{table['store_id']}/tables")  # 지연 닫기 실행 (지금 > 11/4 11:00)
    db_session.refresh(old)
    assert (old.status, old.closed_reason) == ("LEFT", "END_OF_DAY")
    assert old.left_at is not None
    assert old.left_at.replace(tzinfo=UTC) == datetime(2026, 11, 3, 12, 0, tzinfo=UTC)


def test_auto_close_skips_unknown_hours_and_guest_does_not_join_stale(
    staff: TestClient, phone: TestClient, db_session: Session, table: dict
) -> None:
    store_url = f"/api/v1/stores/{table['store_id']}"
    staff.patch(store_url, json={"opening_hours": "언제나"})
    stale = _seat(db_session, table, datetime(2026, 1, 1, 5, 0, tzinfo=UTC))
    staff.get(f"{store_url}/tables")
    db_session.refresh(stale)
    assert stale.status == "SEATED"  # 시각을 읽을 수 없으면 닫지 않는다

    staff.patch(store_url, json={"opening_hours": "11:00-21:00"})
    r = phone.post(f"{GUEST}/{table['token']}/session", json={"party_size": 2}).json()
    assert r["joined"] is False  # 지난 영업일 세션에 합류하지 않고 새로 연다
    db_session.refresh(stale)
    assert stale.closed_reason == "END_OF_DAY"


# --- 공휴일 ---


def test_holidays_manual_and_day_type(staff: TestClient, db_session: Session) -> None:
    r = staff.post("/api/v1/holidays", json={"holiday_date": "2026-12-25", "name": "기독탄신일"})
    assert r.status_code == 201 and r.json()["source"] == "MANUAL"
    dup = staff.post("/api/v1/holidays", json={"holiday_date": "2026-12-25", "name": "x"})
    assert dup.json()["code"] == "HOLIDAY_EXISTS"
    assert [h["name"] for h in staff.get("/api/v1/holidays?year=2026").json()] == ["기독탄신일"]
    assert staff.get("/api/v1/holidays?year=2027").json() == []

    assert day_type(db_session, date(2026, 12, 25)) == "HOLIDAY"  # 금요일이지만 공휴일
    assert day_type(db_session, date(2026, 12, 26)) == "WEEKEND"
    assert day_type(db_session, date(2026, 12, 24)) == "WEEKDAY"


def test_kasi_response_parsing() -> None:
    from scripts.fetch_holidays import parse_response

    def wrap(items: object) -> dict:
        return {"response": {"header": {"resultCode": "00"}, "body": {"items": items}}}

    many = wrap(
        {
            "item": [
                {"locdate": 20260101, "dateName": "1월1일", "isHoliday": "Y"},
                {"locdate": 20260216, "dateName": "설날", "isHoliday": "Y"},
                {"locdate": 20260501, "dateName": "근로자의 날", "isHoliday": "N"},
            ]
        }
    )
    assert parse_response(many) == [(date(2026, 1, 1), "1월1일"), (date(2026, 2, 16), "설날")]
    one = wrap({"item": {"locdate": 20261009, "dateName": "한글날", "isHoliday": "Y"}})
    assert parse_response(one) == [(date(2026, 10, 9), "한글날")]
    assert parse_response(wrap("")) == []
    with pytest.raises(RuntimeError):
        parse_response({"response": {"header": {"resultCode": "30", "resultMsg": "KEY"}}})


def test_new_fields_hold_no_personal_data(db_session: Session) -> None:
    # AC-7: 새 컬럼은 선택값뿐. 이름·연락처·자유 입력 컬럼이 없다
    from app.db.models import Holiday, SessionSlot

    cols = {c.name for c in SessionSlot.__table__.c} | {c.name for c in VisitSession.__table__.c}
    assert not cols & {"name", "phone", "email", "birth", "nickname"}
    assert {c.name for c in Holiday.__table__.c} == {"holiday_date", "name", "source", "created_at"}
    assert db_session.scalars(select(StoreTable)).all() == []


def test_floor_reset_api_restores_preset(staff: TestClient, table: dict) -> None:
    base = f"/api/v1/stores/{table['store_id']}"
    assert (
        staff.patch(
            f"{base}/tables/{table['table_id']}", json={"grid_x": 20, "grid_y": 20}
        ).status_code
        == 200
    )
    first = staff.post(f"{base}/floor/reset")
    assert first.status_code == 200
    by_name = {t["name"]: (t["grid_x"], t["grid_y"], t["orientation"]) for t in first.json()}
    assert by_name == {n: (x, y, o) for n, x, y, o, _ in MEAL_LOVE_TABLES}
    assert staff.post(f"{base}/floor/reset").json() == first.json()
    assert staff.post(f"/api/v1/stores/{uuid.uuid4()}/floor/reset").status_code == 404
