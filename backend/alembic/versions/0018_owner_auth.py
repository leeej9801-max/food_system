"""점주 카카오 계정·매장 연결·OAuth state·세션·refresh (전역 테이블, RLS 없음)."""

import sqlalchemy as sa
from alembic import op

revision = "0018_owner_auth"
down_revision = "0017_staff_kakao_qr"
branch_labels = None
depends_on = None

TABLES = (
    "owner_accounts",
    "owner_stores",
    "owner_oauth_states",
    "owner_sessions",
    "owner_refresh_tokens",
)


def instant(name, nullable=True):
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade():
    op.create_table(
        "owner_accounts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("kakao_id", sa.String(64), nullable=False, unique=True),
        sa.Column("nickname", sa.String(100)),
        instant("created_at", False),
        instant("last_login_at", False),
    )
    op.create_table(
        "owner_stores",
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("owner_accounts.id"), primary_key=True),
        sa.Column("store_id", sa.Uuid(), sa.ForeignKey("stores.id"), primary_key=True),
    )
    op.create_table(
        "owner_oauth_states",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("state_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("verifier", sa.String(128), nullable=False),
        instant("expires_at", False),
        instant("used_at"),
    )
    op.create_table(
        "owner_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("owner_accounts.id"), nullable=False),
        instant("created_at", False),
        instant("expires_at", False),
        instant("revoked_at"),
    )
    op.create_table(
        "owner_refresh_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("owner_sessions.id"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        instant("used_at"),
    )
    op.create_index("ix_owner_sessions_owner_id", "owner_sessions", ["owner_id"])
    op.create_index("ix_owner_refresh_tokens_session_id", "owner_refresh_tokens", ["session_id"])
    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(
                f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_app') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO food_app; END IF; END $$"
            )
            for role in ("food_guest", "food_admin"):
                op.execute(
                    f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN REVOKE ALL ON {table} FROM {role}; END IF; END $$"
                )


def downgrade():
    for table in reversed(TABLES):
        op.drop_table(table)
