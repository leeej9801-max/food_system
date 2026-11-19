"""Attendance idempotency, staff lifecycle and append-only audit logs.

Revision ID: 0016_attendance_integrity
Revises: 0015_attendance
"""

import sqlalchemy as sa
from alembic import op

revision = "0016_attendance_integrity"
down_revision = "0015_attendance"
branch_labels = None
depends_on = None

INDEXES = (
    ("ix_attendance_events_store_occurred", "attendance_events", ["store_id", "occurred_at"]),
    (
        "ix_attendance_events_store_staff_occurred",
        "attendance_events",
        ["store_id", "staff_id", "occurred_at"],
    ),
    ("ix_attendance_shifts_store_date", "attendance_shifts", ["store_id", "work_date"]),
)


def upgrade() -> None:
    postgres = op.get_bind().dialect.name == "postgresql"
    op.add_column(
        "staff", sa.Column("status", sa.String(8), nullable=False, server_default="ACTIVE")
    )
    op.add_column("attendance_events", sa.Column("client_event_id", sa.Uuid(), nullable=True))
    if postgres:
        # 0014의 불변 트리거/RLS를 이 트랜잭션의 기존 행 backfill 동안만 해제한다.
        op.execute("ALTER TABLE attendance_events DISABLE TRIGGER attendance_immutable")
        op.execute("ALTER TABLE attendance_events NO FORCE ROW LEVEL SECURITY")
    else:
        op.execute("DROP TRIGGER attendance_events_no_update")
    op.execute("UPDATE attendance_events SET client_event_id = id")
    if postgres:
        op.execute("ALTER TABLE attendance_events FORCE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE attendance_events ENABLE TRIGGER attendance_immutable")
        op.alter_column("attendance_events", "client_event_id", nullable=False)
        op.create_unique_constraint(
            "uq_attendance_event_client",
            "attendance_events",
            ["store_id", "staff_id", "client_event_id"],
        )
        op.create_check_constraint("ck_staff_status", "staff", "status IN ('ACTIVE', 'INACTIVE')")
    else:
        op.execute(
            "CREATE TRIGGER attendance_events_no_update BEFORE UPDATE ON attendance_events BEGIN SELECT RAISE(ABORT, 'attendance records are append-only'); END"
        )
        op.create_index(
            "uq_attendance_event_client",
            "attendance_events",
            ["store_id", "staff_id", "client_event_id"],
            unique=True,
        )
        # SQLite 표를 재생성하지 않고 기존 FK·이력을 보존하며 동등 제약을 트리거로 건다.
        op.execute(
            "CREATE TRIGGER attendance_events_client_required BEFORE INSERT ON attendance_events WHEN NEW.client_event_id IS NULL BEGIN SELECT RAISE(ABORT, 'client_event_id is required'); END"
        )
        for verb in ("INSERT", "UPDATE"):
            op.execute(
                f"CREATE TRIGGER staff_status_{verb.lower()} BEFORE {verb} ON staff WHEN NEW.status NOT IN ('ACTIVE', 'INACTIVE') BEGIN SELECT RAISE(ABORT, 'invalid staff status'); END"
            )
    for name, table, columns in INDEXES:
        op.create_index(name, table, columns)
    op.create_table(
        "attendance_event_retries",
        sa.Column(
            "store_id", sa.Uuid(), sa.ForeignKey("stores.id", ondelete="RESTRICT"), primary_key=True
        ),
        sa.Column(
            "staff_id", sa.Uuid(), sa.ForeignKey("staff.id", ondelete="RESTRICT"), primary_key=True
        ),
        sa.Column("client_event_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "event_id",
            sa.Uuid(),
            sa.ForeignKey("attendance_events.id", ondelete="RESTRICT"),
            nullable=False,
        ),
    )
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "store_id", sa.Uuid(), sa.ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("actor", sa.String(64), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("entity", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("before", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("after", sa.JSON(none_as_null=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_audit_logs_store_created", "audit_logs", ["store_id", "created_at"])
    for table in ("audit_logs", "attendance_event_retries"):
        if postgres:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            op.execute(
                f"CREATE POLICY store_isolation ON {table} USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id())"
            )
            op.execute(
                f"CREATE TRIGGER attendance_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION attendance_reject_mutation()"
            )
            op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
            for role in ("food_app", "food_guest", "food_admin"):
                grant = (
                    f"GRANT SELECT, INSERT ON {table} TO food_app;" if role == "food_app" else ""
                )
                op.execute(
                    f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN REVOKE ALL ON {table} FROM {role}; {grant} END IF; END $$"
                )
        else:
            for verb in ("UPDATE", "DELETE"):
                op.execute(
                    f"CREATE TRIGGER {table}_no_{verb.lower()} BEFORE {verb} ON {table} BEGIN SELECT RAISE(ABORT, 'attendance records are append-only'); END"
                )


def downgrade() -> None:
    postgres = op.get_bind().dialect.name == "postgresql"
    op.drop_table("audit_logs")
    op.drop_table("attendance_event_retries")
    for name, table, _ in reversed(INDEXES):
        op.drop_index(name, table_name=table)
    if postgres:
        op.drop_constraint("uq_attendance_event_client", "attendance_events", type_="unique")
        op.drop_constraint("ck_staff_status", "staff", type_="check")
    else:
        op.execute("DROP TRIGGER attendance_events_client_required")
        for verb in ("insert", "update"):
            op.execute(f"DROP TRIGGER staff_status_{verb}")
        op.drop_index("uq_attendance_event_client", table_name="attendance_events")
    op.drop_column("attendance_events", "client_event_id")
    op.drop_column("staff", "status")
