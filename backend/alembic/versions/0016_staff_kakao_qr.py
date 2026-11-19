"""직원 카카오 세션·초대·회전 QR 사용 기록 (QR 토큰 미저장)."""

import sqlalchemy as sa
from alembic import op

revision = "0016_staff_kakao_qr"
down_revision = "0015_attendance_integrity"
branch_labels = None
depends_on = None

TABLES = (
    "staff_identities",
    "staff_invites",
    "staff_sessions",
    "staff_refresh_tokens",
    "staff_oauth_states",
    "attendance_qr_secrets",
    "attendance_qr_uses",
)


def identity():
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("store_id", sa.Uuid(), sa.ForeignKey("stores.id"), nullable=False),
    ]


def staff():
    return sa.Column("staff_id", sa.Uuid(), sa.ForeignKey("staff.id"), nullable=False)


def instant(name, nullable=True):
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade():
    op.create_table(
        "staff_identities",
        *identity(),
        staff(),
        sa.Column("kakao_id", sa.String(64), nullable=False),
        sa.Column("nickname", sa.String(100), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.UniqueConstraint("store_id", "staff_id"),
        sa.UniqueConstraint("store_id", "kakao_id"),
        sa.CheckConstraint("status IN ('PENDING', 'ACTIVE')"),
    )
    op.create_table(
        "staff_invites",
        *identity(),
        staff(),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        instant("expires_at", False),
        instant("used_at"),
    )
    op.create_table(
        "staff_sessions",
        *identity(),
        staff(),
        instant("created_at", False),
        instant("expires_at", False),
        instant("revoked_at"),
    )
    op.create_table(
        "staff_refresh_tokens",
        *identity(),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("staff_sessions.id"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        instant("used_at"),
    )
    op.create_table(
        "staff_oauth_states",
        *identity(),
        sa.Column("state_hash", sa.String(64), nullable=False, unique=True),
        instant("expires_at", False),
        instant("used_at"),
    )
    op.create_table(
        "attendance_qr_secrets",
        sa.Column("store_id", sa.Uuid(), sa.ForeignKey("stores.id"), primary_key=True),
        sa.Column("secret", sa.String(64), nullable=False),
    )
    op.create_table(
        "attendance_qr_uses",
        sa.Column("store_id", sa.Uuid(), sa.ForeignKey("stores.id"), primary_key=True),
        sa.Column("staff_id", sa.Uuid(), sa.ForeignKey("staff.id"), primary_key=True),
        sa.Column("window", sa.BigInteger(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("attendance_events.id"), nullable=False),
    )
    for table in TABLES[:5]:
        op.create_index(f"ix_{table}_store_id", table, ["store_id"])
    op.create_index("ix_staff_sessions_staff_id", "staff_sessions", ["staff_id"])
    op.create_index("ix_staff_refresh_tokens_session_id", "staff_refresh_tokens", ["session_id"])
    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            op.execute(
                f"CREATE POLICY store_isolation ON {table} USING (store_id = app_current_store_id()) WITH CHECK (store_id = app_current_store_id())"
            )
            perms = (
                "SELECT, INSERT"
                if table == "attendance_qr_uses"
                else "SELECT, INSERT, UPDATE, DELETE"
            )
            op.execute(
                f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_app') THEN REVOKE ALL ON {table} FROM food_app; GRANT {perms} ON {table} TO food_app; END IF; END $$"
            )
            for role in ("food_guest", "food_admin"):
                op.execute(
                    f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN REVOKE ALL ON {table} FROM {role}; END IF; END $$"
                )
        op.execute(
            "CREATE TRIGGER attendance_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON attendance_qr_uses FOR EACH STATEMENT EXECUTE FUNCTION attendance_reject_mutation()"
        )
    else:
        for verb in ("UPDATE", "DELETE"):
            op.execute(
                f"CREATE TRIGGER attendance_qr_uses_no_{verb.lower()} BEFORE {verb} ON attendance_qr_uses BEGIN SELECT RAISE(ABORT, 'attendance records are append-only'); END"
            )


def downgrade():
    for table in reversed(TABLES):
        op.drop_table(table)
