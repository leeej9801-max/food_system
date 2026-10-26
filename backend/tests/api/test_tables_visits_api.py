from collections.abc import Generator

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


def test_ac1_ac2_store_initial_tables_and_table_update(client: TestClient) -> None:
    store_resp = client.post(
        "/api/v1/stores",
        json={
            "name": "트라토리아 서울",
            "business_days": "화,수,목,금,토,일",
            "opening_hours": "11:30-22:00",
            "initial_table_count": 5,
            "default_seats": 4,
        },
    )
    assert store_resp.status_code == 201
    store = store_resp.json()

    tables = client.get(f"/api/v1/stores/{store['id']}/tables").json()
    assert len(tables) == 5
    assert tables[0]["name"] == "T1"
    assert tables[0]["seats"] == 4

    # 테이블 좌석 수 및 좌표 수정
    t1 = tables[0]
    patched = client.patch(
        f"/api/v1/stores/{store['id']}/tables/{t1['id']}",
        json={"name": "창가 T1", "seats": 2, "grid_x": 3, "grid_y": 1},
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["name"] == "창가 T1"
    assert body["seats"] == 2
    assert body["grid_x"] == 3
    assert body["grid_y"] == 1


def test_ac3_ac4_ac5_visit_lifecycle_separates_payment_and_leaving_and_preserves_history(
    client: TestClient,
) -> None:
    store = client.post(
        "/api/v1/stores",
        json={"name": "비스트로 원", "initial_table_count": 2},
    ).json()
    store_id = store["id"]
    tables = client.get(f"/api/v1/stores/{store_id}/tables").json()
    t1_id = tables[0]["id"]

    # 착석 시작
    seated_resp = client.post(
        f"/api/v1/stores/{store_id}/visits",
        json={"table_id": t1_id, "party_size": 3, "age_band": "30S"},
    )
    assert seated_resp.status_code == 201
    visit = seated_resp.json()
    assert visit["status"] == "SEATED"
    assert visit["paid_at"] is None
    assert visit["left_at"] is None

    # 동일 테이블 중복 착석 시도 -> 409
    dup_resp = client.post(
        f"/api/v1/stores/{store_id}/visits",
        json={"table_id": t1_id, "party_size": 2},
    )
    assert dup_resp.status_code == 409
    assert dup_resp.json()["error"]["code"] == "TABLE_ALREADY_OCCUPIED"

    # AC-4: 결제 완료(PAID)로 변경 -> paid_at 기록되지만 left_at은 여전히 None이고 테이블은 점유 상태 유지
    paid_resp = client.patch(
        f"/api/v1/stores/{store_id}/visits/{visit['id']}",
        json={"status": "PAID"},
    )
    assert paid_resp.status_code == 200
    paid_body = paid_resp.json()
    assert paid_body["status"] == "PAID"
    assert paid_body["paid_at"] is not None
    assert paid_body["left_at"] is None

    tables_after_paid = client.get(f"/api/v1/stores/{store_id}/tables").json()
    assert tables_after_paid[0]["active_visit"] is not None
    assert tables_after_paid[0]["active_visit"]["status"] == "PAID"

    # 실제 퇴점(LEFT, 테이블 비우기) -> left_at 기록되고 테이블의 active_visit은 비워짐
    left_resp = client.patch(
        f"/api/v1/stores/{store_id}/visits/{visit['id']}",
        json={"status": "LEFT"},
    )
    assert left_resp.status_code == 200
    left_body = left_resp.json()
    assert left_body["status"] == "LEFT"
    assert left_body["left_at"] is not None

    tables_after_left = client.get(f"/api/v1/stores/{store_id}/tables").json()
    assert tables_after_left[0]["active_visit"] is None

    # AC-5: 테이블 비우기 이후에도 과거 방문 이력과 누적 방문 인원이 보존됨
    summary = client.get(f"/api/v1/stores/{store_id}/visits").json()
    assert summary["active_table_count"] == 0
    assert summary["total_visit_count"] == 1
    assert summary["total_guest_count"] == 3
    assert summary["sessions"][0]["id"] == visit["id"]
