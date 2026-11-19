"""작업 지시가 허용한 격리 SQLite 검사. PostgreSQL 권한/RLS 검증은 대체하지 않는다."""

import importlib.util
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, inspect, select, text
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite://")

from app.db.base import Base  # noqa: E402
from app.db.models import AttendanceCorrection, AttendanceEvent, Store  # noqa: E402
from app.db.models.attendance import AuditLog, Staff  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.db.tenancy import RequestContext, bind_store_scope  # noqa: E402
from app.main import create_app  # noqa: E402
from app.schemas.attendance import StaffCreate  # noqa: E402
from app.services import attendance as service  # noqa: E402


def migration(name):
    path = Path(__file__).parents[2] / "alembic" / "versions" / name
    spec = importlib.util.spec_from_file_location("attendance_migration", path.resolve())
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def context(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    attendance_tables = {
        "staff",
        "attendance_shifts",
        "attendance_presets",
        "attendance_events",
        "attendance_corrections",
        "audit_logs",
        "attendance_event_retries",
    }
    Base.metadata.create_all(
        engine, tables=[t for t in Base.metadata.sorted_tables if t.name not in attendance_tables]
    )
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration("0014_attendance.py").upgrade()
            migration("0015_attendance_integrity.py").upgrade()
    with Session(engine) as db:
        store = Store(
            name="테스트 매장",
            timezone="Asia/Seoul",
            business_days="월,화,수,목,금",
            opening_hours="09:00-18:00",
        )
        other = Store(name="다른 테스트 매장", timezone="Asia/Seoul")
        db.add_all([store, other])
        db.commit()
        store_id, other_id = str(store.id), str(other.id)
    app = create_app()

    def database():
        with Session(engine, expire_on_commit=False) as db:
            yield db

    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(service, "utcnow", lambda: datetime(2026, 11, 17, 5, 20, tzinfo=UTC))
    with TestClient(app) as client:
        yield (
            client,
            f"/api/v1/stores/{store_id}/attendance",
            f"/api/v1/stores/{other_id}/attendance",
            engine,
        )
    engine.dispose()


def staff(client, base):
    response = client.post(
        base + "/staff", json={"name": "직원 A", "role": "HALL", "color": "#2f6bff"}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def dashboard(client, base, start="2026-11-17", end="2026-11-17"):
    response = client.get(base, params={"start": start, "end": end})
    assert response.status_code == 200, response.text
    return response.json()


def test_staff_shift_owner_gaps_and_closed_days(context):
    client, base, other, _ = context
    person = staff(client, base)
    payload = {
        "staff_id": person,
        "dates": ["2026-11-17"],
        "start_minute": 600,
        "end_minute": 720,
        "label": "오전",
    }
    assert client.post(base + "/shifts", json=payload).status_code == 201
    assert client.post(base + "/shifts", json=payload).status_code == 409
    assert client.post(other + "/shifts", json=payload).status_code == 404
    assert (
        client.post(
            base + "/shifts",
            json={**payload, "staff_id": None, "start_minute": 720, "end_minute": 840},
        ).status_code
        == 201
    )
    result = dashboard(client, base)
    assert result["summary"][0]["planned_minutes"] == 120
    assert [(gap["started_at"][11:16], gap["ended_at"][11:16]) for gap in result["gaps"]] == [
        ("09:00", "10:00"),
        ("14:00", "18:00"),
    ]
    assert dashboard(client, base, "2026-11-22", "2026-11-22")["gaps"] == []
    assert dashboard(client, other)["staff"] == []
    assert client.get(base, params={"start": "2026-11-17", "end": "2027-01-17"}).status_code == 422


@pytest.mark.parametrize(
    "changes",
    [
        {"end_minute": 630},
        {"start_minute": 615},
        {"end_minute": 599},
        {"end_minute": 1470},
        {"dates": ["2026-11-17", "2026-11-17"]},
    ],
)
def test_bad_schedule(context, changes):
    client, base, _, _ = context
    payload = {"staff_id": None, "dates": ["2026-11-17"], "start_minute": 600, "end_minute": 720}
    assert client.post(base + "/shifts", json={**payload, **changes}).status_code == 422


def test_schedule_resize_presets_and_store_scope(context):
    client, base, other, _ = context
    person = staff(client, base)
    created = client.post(
        base + "/shifts",
        json={
            "staff_id": person,
            "dates": ["2026-11-17", "2026-11-18"],
            "start_minute": 600,
            "end_minute": 720,
        },
    ).json()
    assert len(created) == 2
    target = "/shifts/" + created[0]["id"]
    assert (
        client.put(other + target, json={"start_minute": 600, "end_minute": 780}).status_code == 404
    )
    assert (
        client.put(base + target, json={"start_minute": 600, "end_minute": 780}).status_code == 200
    )
    presets = dashboard(client, base)["presets"]
    presets[0]["label"], presets[0]["start_minute"] = "오전 변경", 540
    assert client.put(base + "/presets", json={"presets": presets}).status_code == 200
    assert dashboard(client, base)["presets"][0]["start_minute"] == 540
    assert client.delete(other + target).status_code == 404
    assert client.delete(base + target).status_code == 200
    assert dashboard(client, base)["shifts"] == []


def test_server_time_duplicates_and_append_only(context):
    client, base, _, engine = context
    person = staff(client, base)
    assert (
        client.post(
            base + "/events",
            json={"staff_id": person, "kind": "IN", "occurred_at": "2000-01-01T00:00:00Z"},
        ).status_code
        == 422
    )
    original = client.post(
        base + "/events", json={"staff_id": person, "kind": "IN", "client_event_id": str(uuid4())}
    )
    assert original.status_code == 201
    assert original.json()["occurred_at"].startswith("2026-11-17T05:20")
    assert (
        client.post(
            base + "/events",
            json={"staff_id": person, "kind": "IN", "client_event_id": str(uuid4())},
        ).status_code
        == 200
    )
    for verb in ("UPDATE attendance_events SET kind='OUT'", "DELETE FROM attendance_events"):
        with pytest.raises(DatabaseError, match="append-only"):
            with engine.begin() as connection:
                connection.execute(text(verb))
    assert len(dashboard(client, base)["events"]) == 1
    future = dashboard(client, base, "2026-11-23", "2026-11-29")
    assert future["sessions"] == []
    assert future["summary"][0]["status"] == "NONE"
    assert future["summary"][0]["actual_minutes"] == 0


def test_correction_original_history_missing_and_overtime(context):
    client, base, other, engine = context
    person = staff(client, base)
    original = client.post(
        base + "/events", json={"staff_id": person, "kind": "IN", "client_event_id": str(uuid4())}
    ).json()
    correction = {
        "staff_id": person,
        "reason": "누락 확인",
        "items": [
            {
                "event_id": original["id"],
                "corrected_kind": "IN",
                "corrected_at": "2026-11-16T00:00:00Z",
            }
        ],
    }
    assert client.post(other + "/corrections", json=correction).status_code == 404
    assert (
        client.post(base + "/corrections", json={**correction, "reason": "  "}).status_code == 422
    )
    assert client.post(base + "/corrections", json=correction).status_code == 201
    result = dashboard(client, base, "2026-11-16", "2026-11-16")
    assert result["sessions"][0]["missing"] is True
    assert result["summary"][0]["actual_minutes"] == 0
    assert result["events"][0]["occurred_at"] == original["occurred_at"]
    added = client.post(
        base + "/corrections",
        json={
            "staff_id": person,
            "reason": "퇴근 누락 추가",
            "items": [{"corrected_kind": "OUT", "corrected_at": "2026-11-16T09:00:00+09:00"}],
        },
    )
    assert added.status_code == 409  # 출근과 같은 시각은 불허
    added = client.post(
        base + "/corrections",
        json={
            "staff_id": person,
            "reason": "퇴근 누락 추가",
            "items": [{"corrected_kind": "OUT", "corrected_at": "2026-11-16T07:00:00Z"}],
        },
    )
    assert added.status_code == 201, added.text
    added_id = added.json()[0]["id"]
    result = dashboard(client, base, "2026-11-16", "2026-11-16")
    assert result["summary"][0]["actual_minutes"] == 420
    assert result["summary"][0]["overtime_minutes"] == 420
    amended = client.post(
        base + "/corrections",
        json={
            "staff_id": person,
            "reason": "퇴근 시각 재확인",
            "items": [
                {
                    "previous_correction_id": added_id,
                    "corrected_kind": "OUT",
                    "corrected_at": "2026-11-16T08:00:00Z",
                }
            ],
        },
    )
    assert amended.status_code == 201
    assert (
        dashboard(client, base, "2026-11-16", "2026-11-16")["summary"][0]["actual_minutes"] == 480
    )
    assert (
        client.post(
            base + "/corrections",
            json={
                "staff_id": person,
                "reason": "오래된 화면",
                "items": [
                    {
                        "previous_correction_id": added_id,
                        "corrected_kind": "OUT",
                        "corrected_at": "2026-11-16T09:00:00Z",
                    }
                ],
            },
        ).status_code
        == 409
    )
    with Session(engine) as db:
        assert len(db.scalars(select(AttendanceEvent)).all()) == 1
        assert len(db.scalars(select(AttendanceCorrection)).all()) == 3
    with pytest.raises(DatabaseError, match="append-only"):
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM attendance_corrections"))


def test_overnight_actual_period_clipping_and_atomic_rollback(context):
    client, base, _, _ = context
    person = staff(client, base)
    result = client.post(
        base + "/corrections",
        json={
            "staff_id": person,
            "reason": "누락 기록",
            "items": [
                {"corrected_kind": "IN", "corrected_at": "2026-11-16T23:00:00+09:00"},
                {"corrected_kind": "OUT", "corrected_at": "2026-11-17T02:00:00+09:00"},
            ],
        },
    )
    assert result.status_code == 201, result.text
    assert dashboard(client, base)["summary"][0]["actual_minutes"] == 120
    assert dashboard(client, base, "2026-11-16", "2026-11-16")["summary"][0]["actual_minutes"] == 60
    assert (
        client.post(
            base + "/corrections",
            json={
                "staff_id": person,
                "reason": "잘못된 순서",
                "items": [{"corrected_kind": "OUT", "corrected_at": "2026-11-17T03:00:00+09:00"}],
            },
        ).status_code
        == 409
    )
    assert len(dashboard(client, base)["corrections"]) == 2


def test_overnight_business_coverage(context):
    client, base, _, engine = context
    with Session(engine) as db:
        store = db.scalar(select(Store).where(Store.opening_hours == "09:00-18:00"))
        assert store is not None
        store.opening_hours = "22:00-02:00"
        db.commit()
    assert (
        client.post(
            base + "/shifts",
            json={"dates": ["2026-11-17"], "start_minute": 1320, "end_minute": 1440},
        ).status_code
        == 201
    )
    assert (
        client.post(
            base + "/shifts", json={"dates": ["2026-11-18"], "start_minute": 0, "end_minute": 120}
        ).status_code
        == 201
    )
    assert dashboard(client, base)["gaps"] == []


def test_idempotent_client_event_returns_original_after_later_events(context, monkeypatch):
    client, base, other, engine = context
    person = staff(client, base)
    payload = {"staff_id": person, "kind": "IN", "client_event_id": str(uuid4())}
    first = client.post(base + "/events", json=payload)
    assert first.status_code == 201
    monkeypatch.setattr(service, "utcnow", lambda: datetime(2026, 11, 17, 6, 20, tzinfo=UTC))
    out = client.post(
        base + "/events", json={**payload, "kind": "OUT", "client_event_id": str(uuid4())}
    )
    assert out.status_code == 201
    retry = client.post(base + "/events", json=payload)
    assert retry.status_code == 200
    assert retry.json() == first.json()
    assert client.post(other + "/events", json=payload).status_code == 404
    second_person = staff(client, base)
    assert (
        client.post(base + "/events", json={**payload, "staff_id": second_person}).status_code
        == 201
    )
    with Session(engine) as db:
        assert (
            len(
                db.scalars(
                    select(AttendanceEvent).where(AttendanceEvent.staff_id == UUID(person))
                ).all()
            )
            == 2
        )


@pytest.mark.parametrize("seconds, expected", [(59.999, 200), (60, 200), (60.001, 409)])
def test_duplicate_kind_sixty_second_boundary(context, monkeypatch, seconds, expected):
    client, base, _, _ = context
    person = staff(client, base)
    now = service.utcnow()
    payload = {"staff_id": person, "kind": "IN", "client_event_id": str(uuid4())}
    first = client.post(base + "/events", json=payload)
    monkeypatch.setattr(service, "utcnow", lambda: now + timedelta(seconds=seconds))
    retry = client.post(base + "/events", json={**payload, "client_event_id": str(uuid4())})
    assert retry.status_code == expected
    if expected == 200:
        assert retry.json() == first.json()
    assert len(dashboard(client, base)["events"]) == 1


def test_event_uuid_validation_and_database_uniqueness(context):
    client, base, _, engine = context
    person = staff(client, base)
    for key in ({}, {"client_event_id": "invalid"}, {"client_event_id": None}):
        assert (
            client.post(
                base + "/events", json={"staff_id": person, "kind": "IN", **key}
            ).status_code
            == 422
        )
    payload = {"staff_id": person, "kind": "IN", "client_event_id": str(uuid4())}
    assert client.post(base + "/events", json=payload).status_code == 201
    with Session(engine) as db:
        row = db.scalar(select(AttendanceEvent))
        assert row is not None
        duplicate = AttendanceEvent(
            store_id=row.store_id,
            staff_id=row.staff_id,
            kind="OUT",
            client_event_id=row.client_event_id,
        )
        db.add(duplicate)
        with pytest.raises(DatabaseError, match="UNIQUE"):
            db.commit()
        db.rollback()
        db.add(AttendanceEvent(store_id=row.store_id, staff_id=row.staff_id, kind="OUT"))
        with pytest.raises(DatabaseError, match="client_event_id is required"):
            db.commit()


def test_staff_deactivation_preserves_history_and_rejects_new_events(context):
    client, base, other, engine = context
    person = staff(client, base)
    payload = {"staff_id": person, "kind": "IN", "client_event_id": str(uuid4())}
    original = client.post(base + "/events", json=payload).json()
    correction = client.post(
        base + "/corrections",
        json={
            "staff_id": person,
            "reason": "시각 확인",
            "items": [
                {
                    "event_id": original["id"],
                    "corrected_kind": "IN",
                    "corrected_at": "2026-11-17T05:00:00Z",
                }
            ],
        },
    )
    assert correction.status_code == 201
    assert (
        client.post(
            base + "/shifts",
            json={
                "staff_id": person,
                "dates": ["2026-11-17"],
                "start_minute": 600,
                "end_minute": 720,
            },
        ).status_code
        == 201
    )
    assert client.delete(other + "/staff/" + person).status_code == 404
    assert client.delete(base + "/staff/" + person).status_code == 200
    assert client.delete(base + "/staff/" + person).status_code == 200
    assert client.get(base + "/staff").json() == []
    assert dashboard(client, base)["staff"] == []
    all_staff = client.get(base + "/staff", params={"include_inactive": True}).json()
    assert all_staff[0]["status"] == "INACTIVE"
    history = client.get(
        base, params={"start": "2026-11-17", "end": "2026-11-17", "include_inactive": True}
    ).json()
    assert history["staff"][0]["id"] == person
    assert history["events"][0] == original
    assert len(history["corrections"]) == len(history["shifts"]) == 1
    blocked = client.post(
        base + "/events", json={**payload, "kind": "OUT", "client_event_id": str(uuid4())}
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "STAFF_INACTIVE"
    retry = client.post(base + "/events", json=payload)
    assert retry.status_code == 200 and retry.json() == original
    with Session(engine) as db:
        stored = db.get(Staff, UUID(person))
        assert stored is not None and stored.status == "INACTIVE"
        assert len(db.scalars(select(AuditLog).where(AuditLog.action == "DEACTIVATE")).all()) == 1


def test_audit_log_covers_staff_schedule_and_corrections_atomically(context):
    client, base, other, engine = context
    person = staff(client, base)
    revised = {"name": "직원 변경", "role": "KITCHEN", "color": "#112233"}
    assert client.put(other + "/staff/" + person, json=revised).status_code == 404
    assert client.put(base + "/staff/" + person, json=revised).status_code == 200
    shift = {"staff_id": person, "dates": ["2026-11-17"], "start_minute": 600, "end_minute": 720}
    created = client.post(base + "/shifts", json=shift).json()[0]
    assert client.post(base + "/shifts", json=shift).status_code == 409
    assert (
        client.put(
            base + "/shifts/" + created["id"], json={"start_minute": 600, "end_minute": 780}
        ).status_code
        == 200
    )
    assert client.delete(base + "/shifts/" + created["id"]).status_code == 200
    corrected = client.post(
        base + "/corrections",
        json={
            "staff_id": person,
            "reason": "누락 보완",
            "items": [{"corrected_kind": "IN", "corrected_at": "2026-11-17T00:00:00Z"}],
        },
    )
    assert corrected.status_code == 201
    invalid = client.post(
        base + "/corrections",
        json={
            "staff_id": person,
            "reason": "순서 오류",
            "items": [{"corrected_kind": "IN", "corrected_at": "2026-11-17T01:00:00Z"}],
        },
    )
    assert invalid.status_code == 409
    assert client.delete(base + "/staff/" + person).status_code == 200
    with Session(engine) as db:
        logs = db.scalars(select(AuditLog).order_by(AuditLog.created_at, AuditLog.id)).all()
        assert [(r.entity, r.action) for r in logs] == [
            ("staff", "CREATE"),
            ("staff", "UPDATE"),
            ("attendance_shifts", "CREATE"),
            ("attendance_shifts", "UPDATE"),
            ("attendance_shifts", "DELETE"),
            ("attendance_corrections", "CORRECT"),
            ("staff", "DEACTIVATE"),
        ]
        assert logs[0].before is None
        assert logs[1].before is not None and logs[1].after is not None
        assert logs[3].before is not None and logs[3].after is not None
        assert logs[5].after is not None
        assert logs[6].before is not None and logs[6].after is not None
        assert logs[1].before["name"] == "직원 A" and logs[1].after["name"] == revised["name"]
        assert logs[3].before["end_minute"] == 720 and logs[3].after["end_minute"] == 780
        assert logs[4].after is None
        assert logs[5].after["reason"] == "누락 보완"
        assert logs[6].before["status"] == "ACTIVE" and logs[6].after["status"] == "INACTIVE"
        assert all(
            r.store_id == UUID(base.split("/")[-2]) and r.actor == "beta-staff" for r in logs
        )
        assert len(db.scalars(select(AttendanceCorrection)).all()) == 1
        bind_store_scope(db, RequestContext(UUID(base.split("/")[-2]), actor="user:qa"))
        service.update_staff(
            db, UUID(base.split("/")[-2]), UUID(person), StaffCreate.model_validate(revised)
        )
        assert db.scalar(select(AuditLog).where(AuditLog.actor == "user:qa")) is not None


@pytest.mark.parametrize("table", ["attendance_events", "attendance_corrections", "audit_logs"])
@pytest.mark.parametrize("verb", ["UPDATE", "DELETE"])
def test_all_append_only_tables_reject_mutations(context, table, verb):
    client, base, _, engine = context
    person = staff(client, base)
    assert (
        client.post(
            base + "/events",
            json={"staff_id": person, "kind": "IN", "client_event_id": str(uuid4())},
        ).status_code
        == 201
    )
    assert (
        client.post(
            base + "/corrections",
            json={
                "staff_id": person,
                "reason": "확인",
                "items": [
                    {"corrected_kind": "OUT", "corrected_at": "2026-11-17T05:19:00Z"},
                    {
                        "event_id": dashboard(client, base)["events"][0]["id"],
                        "corrected_kind": "IN",
                        "corrected_at": "2026-11-17T05:00:00Z",
                    },
                ],
            },
        ).status_code
        == 201
    )
    statement = (
        f"UPDATE {table} SET store_id=store_id" if verb == "UPDATE" else f"DELETE FROM {table}"
    )
    with pytest.raises(DatabaseError, match="append-only"):
        with engine.begin() as connection:
            connection.execute(text(statement))
    with engine.connect() as connection:
        assert connection.scalar(text(f"SELECT count(*) FROM {table}")) > 0


def test_migration_roundtrip_preserves_legacy_history(context):
    _, base, _, engine = context
    store_id = UUID(base.split("/")[-2]).hex
    person, original, correction = uuid4().hex, uuid4().hex, uuid4().hex
    module = migration("0015_attendance_integrity.py")
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            module.downgrade()
        connection.execute(
            text(
                "INSERT INTO staff (id,store_id,name,role,color,created_at) VALUES (:id,:store,'QA','HALL','#112233',CURRENT_TIMESTAMP)"
            ),
            {"id": person, "store": store_id},
        )
        connection.execute(
            text(
                "INSERT INTO attendance_events (id,store_id,staff_id,kind,created_at) VALUES (:id,:store,:staff,'IN',CURRENT_TIMESTAMP)"
            ),
            {"id": original, "store": store_id, "staff": person},
        )
        connection.execute(
            text(
                "INSERT INTO attendance_corrections (id,store_id,staff_id,event_id,corrected_kind,corrected_at,reason,created_at) VALUES (:id,:store,:staff,:event,'IN',CURRENT_TIMESTAMP,'QA',CURRENT_TIMESTAMP)"
            ),
            {"id": correction, "store": store_id, "staff": person, "event": original},
        )
        before = connection.execute(text("SELECT * FROM attendance_events")).mappings().one()
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
        after = connection.execute(text("SELECT * FROM attendance_events")).mappings().one()
        assert {k: after[k] for k in before} == dict(before)
        assert after["client_event_id"] == original
        assert connection.scalar(text("SELECT status FROM staff")) == "ACTIVE"
        assert connection.scalar(text("SELECT count(*) FROM attendance_corrections")) == 1
        assert {i["name"] for i in inspect(connection).get_indexes("attendance_events")} >= {
            "ix_attendance_events_store_occurred",
            "ix_attendance_events_store_staff_occurred",
        }
        assert "ix_attendance_shifts_store_date" in {
            i["name"] for i in inspect(connection).get_indexes("attendance_shifts")
        }
        with Operations.context(MigrationContext.configure(connection)):
            module.downgrade()
        assert (
            connection.execute(text("SELECT * FROM attendance_events")).mappings().one() == before
        )
        assert connection.scalar(text("SELECT count(*) FROM attendance_corrections")) == 1
    with pytest.raises(DatabaseError, match="append-only"):
        with engine.begin() as connection:
            connection.execute(text("UPDATE attendance_events SET kind='OUT'"))


def test_duplicate_request_key_stays_idempotent_after_window(context, monkeypatch):
    client, base, _, engine = context
    person = staff(client, base)
    now = service.utcnow()
    payload = {"staff_id": person, "kind": "IN", "client_event_id": str(uuid4())}
    first = client.post(base + "/events", json=payload)
    duplicate_payload = {**payload, "client_event_id": str(uuid4())}
    duplicate = client.post(base + "/events", json=duplicate_payload)
    assert duplicate.status_code == 200 and duplicate.json() == first.json()
    monkeypatch.setattr(service, "utcnow", lambda: now + timedelta(minutes=2))
    assert (
        client.post(
            base + "/events", json={**payload, "kind": "OUT", "client_event_id": str(uuid4())}
        ).status_code
        == 201
    )
    retry = client.post(base + "/events", json=duplicate_payload)
    assert retry.status_code == 200 and retry.json() == first.json()
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM attendance_events")) == 2
        assert conn.scalar(text("SELECT count(*) FROM attendance_event_retries")) == 1


def test_attendance_openapi_contract(context):
    client, _, _, _ = context
    current = (
        json.dumps(client.get("/openapi.json").json(), ensure_ascii=False, indent=2, sort_keys=True)
        + "\n"
    )
    snapshot = Path(__file__).parents[1] / "api" / "snapshots" / "openapi.json"
    assert current == snapshot.read_text(encoding="utf-8")
