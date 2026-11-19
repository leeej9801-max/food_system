"""선택 실행: 독립 DB·역할에서 실제 Alembic/RLS/불변 권한을 확인한다."""

import os
import secrets
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

os.environ.setdefault("DATABASE_URL", "sqlite://")

from app.core.config import settings  # noqa: E402
from app.db.models import AttendanceEvent, Staff, Store, utcnow
from app.db.models.attendance import AuditLog
from app.db.tenancy import RequestContext, bind_store_scope
from app.schemas.attendance import EventCreate, StaffCreate
from app.services import attendance as service
from scripts.ensure_runtime_role import ensure_runtime_role

OWNER_URL = os.environ.get("ATTENDANCE_TEST_OWNER_URL")


@pytest.mark.skipif(not OWNER_URL, reason="ATTENDANCE_TEST_OWNER_URL 미설정")
def test_postgres_migration_runtime_permissions_and_rls(monkeypatch):
    assert OWNER_URL is not None
    suffix = uuid4().hex[:12]
    database, role = f"attendance_test_{suffix}", f"attendance_runtime_{suffix}"
    password = secrets.token_hex(24)
    admin = create_engine(OWNER_URL, isolation_level="AUTOCOMMIT")
    url = make_url(OWNER_URL).set(database=database)
    owner_url = url.render_as_string(hide_password=False)
    owner = None
    runtime = None
    try:
        with admin.connect() as conn:
            conn.exec_driver_sql(f"CREATE DATABASE {database}")
        previous_url = settings.database_url
        settings.database_url = owner_url
        try:
            backend = Path(__file__).parents[2]
            config = Config(str(backend / "alembic.ini"))
            config.set_main_option("script_location", str(backend / "alembic"))
            command.upgrade(config, "head")
        finally:
            settings.database_url = previous_url
        ensure_runtime_role(owner_url, role, password)
        ensure_runtime_role(
            owner_url, role, password
        )  # Re-running setup must preserve append-only permissions.
        owner = create_engine(owner_url)
        with Session(owner) as db:
            first, second = Store(name="QA A"), Store(name="QA B")
            db.add_all([first, second])
            db.flush()
            person = Staff(store_id=first.id, name="QA Staff", role="HALL", color="#2f6bff")
            db.add(person)
            db.flush()
            entry = AttendanceEvent(
                store_id=first.id,
                staff_id=person.id,
                kind="IN",
                occurred_at=utcnow(),
                client_event_id=uuid4(),
            )
            db.add(entry)
            db.flush()
            db.add(
                AuditLog(
                    store_id=first.id,
                    actor="operator:qa",
                    action="CREATE",
                    entity="staff",
                    entity_id=person.id,
                    before=None,
                    after={"id": str(person.id)},
                )
            )
            db.commit()
            store_id, other_id = first.id, second.id
        runtime = create_engine(
            url.set(username=role, password=password).render_as_string(hide_password=False)
        )
        with Session(runtime) as db:
            assert db.scalar(text("SELECT count(*) FROM staff")) == 0
            bind_store_scope(db, RequestContext(store_id=other_id))
            assert db.scalar(text("SELECT count(*) FROM staff")) == 0
            bind_store_scope(db, RequestContext(store_id=store_id))
            assert db.scalar(text("SELECT count(*) FROM staff")) == 1
            assert db.scalar(text("SELECT count(*) FROM attendance_events")) == 1
            assert db.scalar(text("SELECT count(*) FROM audit_logs")) == 1
            db.commit()
        with Session(runtime, expire_on_commit=False) as db:
            concurrent_staff = service.create_staff(
                db, store_id, StaffCreate(name="QA concurrent", role="HALL", color="#112233")
            ).id

        def record(client_event_id):
            with Session(runtime, expire_on_commit=False) as db:
                row, created = service.record_event(
                    db,
                    store_id,
                    EventCreate(
                        staff_id=concurrent_staff, kind="IN", client_event_id=client_event_id
                    ),
                )
                return row.id, created

        key = uuid4()
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(record, [key] * 4))
        assert len({row_id for row_id, _ in results}) == 1
        assert sum(created for _, created in results) == 1
        with ThreadPoolExecutor(max_workers=4) as executor:
            duplicates = list(executor.map(record, [uuid4() for _ in range(4)]))
        assert all(row_id == results[0][0] and not created for row_id, created in duplicates)
        for table in ("attendance_events", "attendance_corrections", "audit_logs"):
            for verb in (
                f"UPDATE {table} SET store_id=store_id",
                f"DELETE FROM {table}",
                f"TRUNCATE {table}",
            ):
                with pytest.raises(DBAPIError):
                    with runtime.begin() as conn:
                        conn.exec_driver_sql(verb)
            with owner.connect() as conn:
                assert conn.scalar(
                    text("SELECT has_table_privilege(:role, :table, 'SELECT')"),
                    {"role": role, "table": table},
                )
                assert conn.scalar(
                    text("SELECT has_table_privilege(:role, :table, 'INSERT')"),
                    {"role": role, "table": table},
                )
                for privilege in ("UPDATE", "DELETE", "TRUNCATE"):
                    assert not conn.scalar(
                        text("SELECT has_table_privilege(:role, :table, :privilege)"),
                        {"role": role, "table": table, "privilege": privilege},
                    )
        for table in ("attendance_events", "attendance_corrections", "audit_logs"):
            for verb in (
                f"UPDATE {table} SET store_id=store_id",
                f"DELETE FROM {table}",
                f"TRUNCATE {table} CASCADE",
            ):
                with pytest.raises(DBAPIError, match="append-only"):
                    with owner.begin() as conn:
                        conn.exec_driver_sql(verb)
        with owner.connect() as conn:
            assert (
                conn.scalar(
                    text(
                        "SELECT count(*) FROM pg_policies WHERE policyname='store_isolation' AND tablename IN ('staff','attendance_shifts','attendance_presets','attendance_events','attendance_corrections')"
                    )
                )
                == 5
            )
        # 기존 데이터가 있는 PostgreSQL에서도 downgrade → upgrade가 이력을 보존한다.
        settings.database_url = owner_url
        try:
            command.downgrade(config, "0014_attendance")
            with owner.connect() as conn:
                assert conn.scalar(text("SELECT count(*) FROM attendance_events")) == 2
                legacy = conn.execute(
                    text("SELECT id, occurred_at FROM attendance_events ORDER BY id")
                ).all()
            command.upgrade(config, "head")
            with owner.connect() as conn:
                assert (
                    conn.execute(
                        text("SELECT id, occurred_at FROM attendance_events ORDER BY id")
                    ).all()
                    == legacy
                )
                assert (
                    conn.scalar(
                        text("SELECT count(*) FROM attendance_events WHERE client_event_id=id")
                    )
                    == 2
                )
            with pytest.raises(DBAPIError, match="append-only"):
                with owner.begin() as conn:
                    conn.exec_driver_sql("UPDATE attendance_events SET kind='OUT'")
        finally:
            settings.database_url = previous_url
        # 0016: 실제 런타임 RLS·행 잠금으로 QR/refresh 동시 요청을 검증한다.
        from datetime import timedelta

        from fastapi import Request, Response

        from app.core.errors import AppError
        from app.db.models.staff_auth import StaffIdentity, StaffSession
        from app.repositories import staff_auth as auth_repo
        from app.schemas.staff_auth import QRRecord
        from app.services import staff_auth as auth

        monkeypatch.setattr(settings, "staff_auth_signing_key", secrets.token_urlsafe(48))
        ensure_runtime_role(owner_url, role, password)
        with Session(runtime, expire_on_commit=False) as db:
            bind_store_scope(db, RequestContext(store_id=store_id))
            person = Staff(store_id=store_id, name="QA QR", role="HALL", color="#2f6bff")
            auth_repo.add(db, person)
            auth_repo.add(
                db,
                StaffIdentity(
                    store_id=store_id,
                    staff_id=person.id,
                    kakao_id=str(uuid4().int),
                    nickname="QA",
                    status="ACTIVE",
                ),
            )
            login_session = StaffSession(
                store_id=store_id, staff_id=person.id, expires_at=utcnow() + timedelta(days=60)
            )
            auth_repo.add(db, login_session)
            refresh_token = auth.new_refresh(db, login_session)
            db.commit()
            auth.issue_qr(db, store_id)
            secret = auth_repo.qr_secret(db, store_id)
            assert secret is not None
            window = int(utcnow().timestamp()) // 30
            qr_token = f"{window}.{auth.qr_signature(secret.secret, store_id, window)}"
            access = auth.encode(
                {"sub": str(person.id), "sid": str(login_session.id), "store": str(store_id)},
                "staff-access",
                utcnow() + timedelta(minutes=15),
            )
        payload = QRRecord(qr_token=qr_token, client_event_id=uuid4())
        request = Request(
            {"type": "http", "headers": [(b"cookie", f"{auth.ACCESS_COOKIE}={access}".encode())]}
        )

        def qr_record(_):
            with Session(runtime) as db:
                return auth.record_qr(db, store_id, request, payload).event_id

        with ThreadPoolExecutor(max_workers=4) as executor:
            qr_ids = list(executor.map(qr_record, range(4)))
        assert len(set(qr_ids)) == 1
        with Session(runtime) as db:
            assert db.scalar(text("SELECT count(*) FROM attendance_qr_uses")) == 0
            bind_store_scope(db, RequestContext(store_id=other_id))
            assert db.scalar(text("SELECT count(*) FROM staff_sessions")) == 0
            bind_store_scope(db, RequestContext(store_id=store_id))
            assert db.scalar(text("SELECT count(*) FROM attendance_qr_uses")) == 1
        for verb in (
            'UPDATE attendance_qr_uses SET "window"="window"',
            "DELETE FROM attendance_qr_uses",
            "TRUNCATE attendance_qr_uses",
        ):
            with pytest.raises(DBAPIError), runtime.begin() as conn:
                conn.exec_driver_sql(verb)
            with pytest.raises(DBAPIError, match="append-only"), owner.begin() as conn:
                conn.exec_driver_sql(verb)
        refresh_request = Request(
            {
                "type": "http",
                "headers": [(b"cookie", f"{auth.REFRESH_COOKIE}={refresh_token}".encode())],
            }
        )

        def rotate(_):
            with Session(runtime) as db:
                try:
                    auth.rotate(db, store_id, refresh_request, Response())
                    return "OK"
                except AppError as error:
                    return error.code

        with ThreadPoolExecutor(max_workers=2) as executor:
            rotations = list(executor.map(rotate, range(2)))
        assert sorted(rotations) == ["OK", "REFRESH_REUSED"]
        with Session(runtime) as db:
            bind_store_scope(db, RequestContext(store_id=store_id))
            assert (
                db.scalar(text("SELECT count(*) FROM staff_sessions WHERE revoked_at IS NULL")) == 0
            )
    finally:
        if runtime:
            runtime.dispose()
        if owner:
            owner.dispose()
        with admin.connect() as conn:
            conn.exec_driver_sql(f"DROP DATABASE IF EXISTS {database} WITH (FORCE)")
            conn.exec_driver_sql(f"DROP ROLE IF EXISTS {role}")
        admin.dispose()
