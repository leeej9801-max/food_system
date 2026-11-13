"""Guest area B stage 1: QR tokens, session slots, anonymous devices (WO-20261104-003)

Revision ID: 0007_guest_sessions_slots
Revises: 0006_store_isolation_rls
Create Date: 2026-11-04

New store tables get store_id + the same fail-closed RLS policy as 0006. guest_devices is
global (no store data, no personal data). PostgreSQL also gets app_resolve_table_qr(token):
the guest API has no store scope yet when it reads a QR token, so this SECURITY DEFINER
function returns the store/table for exactly one token and nothing else.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_guest_sessions_slots"
down_revision: str | None = "0006_store_isolation_rls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_TENANT_TABLES = ("table_qr_tokens", "session_slots")
OPEN_FILTER = "status IN ('SEATED', 'PAID')"

# Runs as the function owner (migration role). FORCE RLS applies to the owner too, so the
# owner gets its own read policy on table_qr_tokens below; the runtime role never does.
RESOLVE_FUNCTION = """
CREATE OR REPLACE FUNCTION app_resolve_table_qr(p_token text)
    RETURNS TABLE (store_id uuid, table_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$ SELECT t.store_id, t.table_id FROM table_qr_tokens t WHERE t.token = p_token $$
"""


def upgrade() -> None:
    bind = op.get_bind()
    duplicates = bind.execute(
        sa.text(
            f"SELECT table_id FROM visit_sessions WHERE {OPEN_FILTER} "
            "GROUP BY table_id HAVING count(*) > 1"
        )
    ).fetchall()
    if duplicates:
        # Do not guess which visit to close; staff must close extras first
        raise RuntimeError(
            f"{len(duplicates)} table(s) have more than one open visit session. "
            "Close the extra sessions (status LEFT) and rerun the migration."
        )

    with op.batch_alter_table("visit_sessions") as batch:
        batch.add_column(
            sa.Column("party_size_source", sa.String(20), nullable=False, server_default="STAFF")
        )
        batch.add_column(
            sa.Column("opened_by", sa.String(20), nullable=False, server_default="STAFF")
        )
        batch.add_column(sa.Column("closed_reason", sa.String(20), nullable=True))
    op.create_index(
        "uq_visit_sessions_open_table",
        "visit_sessions",
        ["table_id"],
        unique=True,
        postgresql_where=sa.text(OPEN_FILTER),
        sqlite_where=sa.text(OPEN_FILTER),
    )

    op.create_table(
        "table_qr_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "store_id",
            sa.Uuid(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "table_id",
            sa.Uuid(),
            sa.ForeignKey("store_tables.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_table_qr_tokens_store_id", "table_qr_tokens", ["store_id"])

    op.create_table(
        "guest_devices",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "session_slots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "store_id",
            sa.Uuid(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("visit_sessions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("slot_no", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column(
            "created_by_device_id",
            sa.Uuid(),
            sa.ForeignKey("guest_devices.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column(
            "claimed_by_device_id",
            sa.Uuid(),
            sa.ForeignKey("guest_devices.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("display_opt_out", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("session_id", "slot_no", name="uq_session_slots_session_slot"),
    )
    op.create_index("ix_session_slots_store_id", "session_slots", ["store_id"])
    op.create_index("ix_session_slots_session_id", "session_slots", ["session_id"])
    op.create_index(
        "ix_session_slots_claimed_by_device_id", "session_slots", ["claimed_by_device_id"]
    )

    if bind.dialect.name != "postgresql":
        return
    for table in NEW_TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY store_isolation ON {table} "
            "USING (store_id = app_current_store_id()) "
            "WITH CHECK (store_id = app_current_store_id())"
        )
    op.execute(
        "CREATE POLICY qr_resolve_owner ON table_qr_tokens FOR SELECT TO CURRENT_USER USING (true)"
    )
    op.execute(RESOLVE_FUNCTION)
    # Only roles granted explicitly (scripts/ensure_runtime_role.py) may call it
    op.execute("REVOKE ALL ON FUNCTION app_resolve_table_qr(text) FROM PUBLIC")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP FUNCTION IF EXISTS app_resolve_table_qr(text)")
        op.execute("DROP POLICY IF EXISTS qr_resolve_owner ON table_qr_tokens")
        for table in NEW_TENANT_TABLES:
            op.execute(f"DROP POLICY IF EXISTS store_isolation ON {table}")
    op.drop_table("session_slots")
    op.drop_table("guest_devices")
    op.drop_table("table_qr_tokens")
    op.drop_index("uq_visit_sessions_open_table", table_name="visit_sessions")
    with op.batch_alter_table("visit_sessions") as batch:
        batch.drop_column("closed_reason")
        batch.drop_column("opened_by")
        batch.drop_column("party_size_source")
