"""손님 영역 B 1단계: 테이블 QR → 세션 열기/합류, 슬롯 (WO-20261104-003). SQLite (P-07)."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.models import GuestDevice
from app.db.session import get_db
from app.main import create_app

GUEST = "/api/guest/v1/qr"


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def app(db_session: Session) -> FastAPI:
    app = create_app()

    def _override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    return app


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
        "/api/v1/stores", json={"name": "손님 테스트", "initial_table_count": 2}
    ).json()
    t = staff.get(f"/api/v1/stores/{store['id']}/tables").json()[0]
    token = staff.post(f"/api/v1/stores/{store['id']}/tables/{t['id']}/qr-token").json()["token"]
    return {"store_id": store["id"], "table_id": t["id"], "seats": t["seats"], "token": token}


def test_scan_empty_table_issues_device_cookie_without_personal_data(
    phone: TestClient, table: dict, db_session: Session
) -> None:
    r = phone.get(f"{GUEST}/{table['token']}")
    assert r.status_code == 200
    body = r.json()
    assert body["session"] is None  # U-17: 신호 없는 테이블은 빈 테이블
    assert "store_id" not in body and "table_id" not in body
    raw = phone.cookies.get("food_guest_device")
    assert raw
    devices = list(db_session.scalars(select(GuestDevice)).all())
    assert len(devices) == 1
    assert devices[0].token_hash != raw  # 원문은 저장하지 않는다

    # 같은 기기로 다시 찍으면 새 기기를 만들지 않는다
    phone.get(f"{GUEST}/{table['token']}")
    assert len(list(db_session.scalars(select(GuestDevice)).all())) == 1


def test_unknown_or_rotated_token_is_404(staff: TestClient, phone: TestClient, table: dict) -> None:
    assert phone.get(f"{GUEST}/not-a-token").status_code == 404
    old = table["token"]
    new = staff.post(
        f"/api/v1/stores/{table['store_id']}/tables/{table['table_id']}/qr-token"
    ).json()["token"]
    assert new != old
    assert phone.get(f"{GUEST}/{old}").json()["error"]["code"] == "QR_TOKEN_NOT_FOUND"
    assert phone.get(f"{GUEST}/{new}").status_code == 200
    got = staff.get(f"/api/v1/stores/{table['store_id']}/tables/{table['table_id']}/qr-token")
    assert got.json()["token"] == new


def test_inactive_table_token_is_404(staff: TestClient, phone: TestClient, table: dict) -> None:
    staff.patch(
        f"/api/v1/stores/{table['store_id']}/tables/{table['table_id']}", json={"is_active": False}
    )
    assert phone.get(f"{GUEST}/{table['token']}").status_code == 404


def test_first_scanner_opens_and_second_joins(
    staff: TestClient, phone: TestClient, phone2: TestClient, table: dict
) -> None:
    url = f"{GUEST}/{table['token']}/session"
    assert phone.post(url, json={}).json()["error"]["code"] == "PARTY_SIZE_REQUIRED"

    opened = phone.post(url, json={"party_size": 3}).json()
    assert opened["joined"] is False
    s = opened["session"]
    assert s["party_size"] == 3 and s["party_size_source"] == "GUEST_QR"
    assert [x["state"] for x in s["slots"]] == ["SILHOUETTE"] * 3

    joined = phone2.post(url, json={}).json()
    assert joined["joined"] is True and joined["session"]["party_size"] == 3

    # 인원수가 다르면 덮어쓰지 않고 알려준다
    mism = phone2.post(url, json={"party_size": 5}).json()
    assert mism["party_size_mismatch"] is True and mism["session"]["party_size"] == 3

    visits = staff.get(f"/api/v1/stores/{table['store_id']}/visits").json()
    assert visits["active_table_count"] == 1
    v = visits["sessions"][0]
    assert v["opened_by"] == "GUEST_QR" and v["source"] == "guest_qr"

    # 직원이 같은 테이블에 다시 열 수 없다
    dup = staff.post(
        f"/api/v1/stores/{table['store_id']}/visits",
        json={"table_id": table["table_id"], "party_size": 2},
    )
    assert dup.status_code == 409


def test_staff_first_then_qr_upgrades_source(
    staff: TestClient, phone: TestClient, table: dict
) -> None:
    # 케이스 A: 직원 입력 → 실루엣 N개, 손님이 같은 인원 확인 → 출처 GUEST_QR (U-18)
    v = staff.post(
        f"/api/v1/stores/{table['store_id']}/visits",
        json={"table_id": table["table_id"], "party_size": 2},
    ).json()
    assert v["party_size_source"] == "STAFF" and v["opened_by"] == "STAFF"

    view = phone.get(f"{GUEST}/{table['token']}").json()
    assert [x["state"] for x in view["session"]["slots"]] == ["SILHOUETTE", "SILHOUETTE"]

    joined = phone.post(f"{GUEST}/{table['token']}/session", json={"party_size": 2}).json()
    assert joined["joined"] is True
    assert joined["session"]["party_size_source"] == "GUEST_QR"


def test_new_party_closes_previous_session(
    staff: TestClient, phone: TestClient, phone2: TestClient, table: dict
) -> None:
    # 케이스 H: 이전 세션이 안 닫힌 채 새 손님 → "지금 앉으셨나요?" 확인 후 새로 연다
    url = f"{GUEST}/{table['token']}/session"
    phone.post(url, json={"party_size": 2})
    r = phone2.post(url, json={"party_size": 4, "new_party": True}).json()
    assert r["joined"] is False and r["session"]["party_size"] == 4

    sessions = staff.get(f"/api/v1/stores/{table['store_id']}/visits").json()["sessions"]
    closed = [s for s in sessions if s["status"] == "LEFT"]
    assert len(closed) == 1 and closed[0]["closed_reason"] == "NEXT_PARTY"


def test_slot_add_remove_rules(phone: TestClient, phone2: TestClient, table: dict) -> None:
    base = f"{GUEST}/{table['token']}/session"
    phone.post(base, json={"party_size": table["seats"]})

    added = phone.post(f"{base}/slots").json()
    assert added["session"]["party_size"] == table["seats"] + 1
    assert added["over_seats"] is True  # 막지 않고 프론트가 확인

    # 가져간 자리는 뺄 수 없다
    phone2.post(f"{base}/slots/1/claim")
    assert phone.delete(f"{base}/slots/1").json()["error"]["code"] == "SLOT_NOT_REMOVABLE"

    removed = phone.delete(f"{base}/slots/{table['seats'] + 1}").json()
    assert removed["session"]["party_size"] == table["seats"]
    assert phone.delete(f"{base}/slots/99").status_code == 404


def test_cannot_remove_last_slot(phone: TestClient, table: dict) -> None:
    base = f"{GUEST}/{table['token']}/session"
    phone.post(base, json={"party_size": 1})
    assert phone.delete(f"{base}/slots/1").status_code == 409


def test_claim_and_display_opt_out(phone: TestClient, phone2: TestClient, table: dict) -> None:
    base = f"{GUEST}/{table['token']}/session"
    phone.post(base, json={"party_size": 2})

    mine = phone.post(f"{base}/slots/1/claim").json()["session"]["slots"]
    assert mine[0]["is_mine"] is True and mine[0]["is_claimed"] is True
    # 다른 기기에서는 "가져감"만 보이고 내 것이 아니다. 기기 ID는 응답에 없다
    other = phone2.get(f"{GUEST}/{table['token']}").json()["session"]["slots"]
    assert other[0]["is_mine"] is False and other[0]["is_claimed"] is True
    assert "claimed_by_device_id" not in other[0]

    assert phone2.post(f"{base}/slots/1/claim").json()["error"]["code"] == "SLOT_ALREADY_CLAIMED"
    assert phone.post(f"{base}/slots/1/claim").status_code == 200  # 같은 기기는 그대로

    # 케이스 L: 본인만 화면 표시 거부
    denied = phone2.patch(f"{base}/slots/1", json={"display_opt_out": True})
    assert denied.status_code == 403
    ok = phone.patch(f"{base}/slots/1", json={"display_opt_out": True}).json()
    assert ok["session"]["slots"][0]["display_opt_out"] is True


def test_slot_actions_need_open_session(phone: TestClient, table: dict) -> None:
    r = phone.post(f"{GUEST}/{table['token']}/session/slots")
    assert r.json()["error"]["code"] == "NO_OPEN_SESSION"


def test_staff_party_size_and_clear(staff: TestClient, phone: TestClient, table: dict) -> None:
    visits = f"/api/v1/stores/{table['store_id']}/visits"
    v = staff.post(visits, json={"table_id": table["table_id"], "party_size": 3}).json()
    phone.post(f"{GUEST}/{table['token']}/session/slots/2/claim")
    phone.post(f"{GUEST}/{table['token']}/session/slots/3/claim")

    # 줄여도 손님이 가져간 자리는 남는다
    down = staff.patch(f"{visits}/{v['id']}", json={"party_size": 1}).json()
    assert down["party_size"] == 2
    slots = phone.get(f"{GUEST}/{table['token']}").json()["session"]["slots"]
    assert [s["slot_no"] for s in slots] == [2, 3]

    up = staff.patch(f"{visits}/{v['id']}", json={"party_size": 4}).json()
    assert up["party_size"] == 4

    left = staff.patch(f"{visits}/{v['id']}", json={"status": "LEFT"}).json()
    assert left["closed_reason"] == "CLEARED"
    assert phone.get(f"{GUEST}/{table['token']}").json()["session"] is None

    # 닫힌 뒤 새 세션이 열리면 옛 세션을 다시 열 수 없다 (테이블당 1개)
    phone.post(f"{GUEST}/{table['token']}/session", json={"party_size": 2})
    reopen = staff.patch(f"{visits}/{v['id']}", json={"status": "SEATED"})
    assert reopen.status_code == 409


def test_guest_cannot_add_more_than_20_slots(phone: TestClient, table: dict) -> None:
    base = f"{GUEST}/{table['token']}/session"
    assert phone.post(base, json={"party_size": 20}).status_code == 200
    r = phone.post(f"{base}/slots")
    assert r.status_code == 409 and r.json()["error"]["code"] == "SLOT_LIMIT"
