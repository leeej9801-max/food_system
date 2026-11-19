"""Attendance schedules and append-only original/correction records.

Revision ID: 0015_attendance
Revises: 0014_monthly_goals
"""

import sqlalchemy as sa
from alembic import op

revision = "0015_attendance"
down_revision = "0014_monthly_goals"
branch_labels = None
depends_on = None

TABLES = (
    "staff",
    "attendance_shifts",
    "attendance_presets",
    "attendance_events",
    "attendance_corrections",
)
APPEND_ONLY = ("attendance_events", "attendance_corrections")


def _identity():
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "store_id", sa.Uuid(), sa.ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False
        ),
    ]


def _staff(nullable=False):
    return sa.Column(
        "staff_id", sa.Uuid(), sa.ForeignKey("staff.id", ondelete="RESTRICT"), nullable=nullable
    )


def _times():
    return [
        sa.Column("start_minute", sa.Integer(), nullable=False),
        sa.Column("end_minute", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(30), nullable=False),
        sa.CheckConstraint(
            "start_minute >= 0 AND end_minute <= 1440 AND end_minute - start_minute >= 60"
        ),
        sa.CheckConstraint("start_minute % 30 = 0 AND end_minute % 30 = 0"),
    ]


def _created():
    return sa.Column("created_at", sa.DateTime(timezone=True), nullable=False)


def upgrade() -> None:
    op.create_table(
        "staff",
        *_identity(),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        _created(),
        sa.CheckConstraint("role IN ('HALL', 'KITCHEN')"),
    )
    op.create_table(
        "attendance_shifts",
        *_identity(),
        _staff(nullable=True),
        sa.Column("work_date", sa.Date(), nullable=False),
        *_times(),
    )
    op.create_table(
        "attendance_presets",
        *_identity(),
        sa.Column("key", sa.String(10), nullable=False),
        *_times(),
        sa.UniqueConstraint("store_id", "key"),
    )
    op.create_table(
        "attendance_events",
        *_identity(),
        _staff(),
        sa.Column("device_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(3), nullable=False),
        sa.Column(
            "occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        _created(),
        sa.CheckConstraint("kind IN ('IN', 'OUT')"),
    )
    op.create_table(
        "attendance_corrections",
        *_identity(),
        _staff(),
        sa.Column(
            "event_id",
            sa.Uuid(),
            sa.ForeignKey("attendance_events.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column(
            "previous_correction_id",
            sa.Uuid(),
            sa.ForeignKey("attendance_corrections.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("corrected_kind", sa.String(3), nullable=False),
        sa.Column("corrected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("corrected_by_user_id", sa.Uuid(), nullable=True),
        _created(),
        sa.CheckConstraint("corrected_kind IN ('IN', 'OUT')"),
        sa.CheckConstraint("length(trim(reason)) > 0"),
    )
    for table in TABLES:
        op.create_index(f"ix_{table}_store_id", table, ["store_id"])
    op.create_index("ix_attendance_shifts_work_date", "attendance_shifts", ["work_date"])
    for table in APPEND_ONLY:
        op.create_index(f"ix_{table}_staff_id", table, ["staff_id"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "CREATE FUNCTION attendance_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'attendance records are append-only'; END $$"
        )
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            op.execute(
                f"CREATE POLICY store_isolation ON {table} USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id())"
            )
            permissions = (
                "SELECT, INSERT" if table in APPEND_ONLY else "SELECT, INSERT, UPDATE, DELETE"
            )
            op.execute(
                f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_app') THEN REVOKE ALL ON {table} FROM food_app; GRANT {permissions} ON {table} TO food_app; END IF; END $$"
            )
        for table in APPEND_ONLY:
            op.execute(
                f"CREATE TRIGGER attendance_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION attendance_reject_mutation()"
            )
            for role in ("food_guest", "food_admin"):
                op.execute(
                    f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN REVOKE UPDATE, DELETE, TRUNCATE ON {table} FROM {role}; END IF; END $$"
                )
    else:
        for table in APPEND_ONLY:
            for verb in ("UPDATE", "DELETE"):
                op.execute(
                    f"CREATE TRIGGER {table}_no_{verb.lower()} BEFORE {verb} ON {table} BEGIN SELECT RAISE(ABORT, 'attendance records are append-only'); END"
                )


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP FUNCTION attendance_reject_mutation()")
