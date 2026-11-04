"""Floor layout, per-person profile, visit context, holidays (WO-20261105-001)

Revision ID: 0008_floor_profile_holidays
Revises: 0007_guest_sessions_slots
Create Date: 2026-11-05

Only columns are added to existing store tables, so their store_isolation policies from
0006/0007 keep applying. holidays is a global calendar (no store data), so it has no
store_id and no RLS (ADR-013 global table). Existing rows keep their values: slots get
UNRECORDED profiles, visits keep their age_band, tables become horizontal ("H").
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_floor_profile_holidays"
down_revision: str | None = "0007_guest_sessions_slots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("stores") as batch:
        batch.add_column(sa.Column("floor_fixtures", sa.Text(), nullable=True))
    with op.batch_alter_table("store_tables") as batch:
        batch.add_column(sa.Column("orientation", sa.String(1), nullable=False, server_default="H"))
    with op.batch_alter_table("visit_sessions") as batch:
        batch.add_column(sa.Column("purpose", sa.String(20), nullable=True))
        batch.add_column(sa.Column("relationship", sa.String(20), nullable=True))
        batch.add_column(sa.Column("context_source", sa.String(10), nullable=True))
    with op.batch_alter_table("session_slots") as batch:
        batch.add_column(
            sa.Column("gender", sa.String(12), nullable=False, server_default="UNRECORDED")
        )
        batch.add_column(
            sa.Column("age_band", sa.String(32), nullable=False, server_default="UNRECORDED")
        )
        batch.add_column(sa.Column("profile_source", sa.String(10), nullable=True))

    op.create_table(
        "holidays",
        sa.Column("holiday_date", sa.Date(), primary_key=True),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("source", sa.String(10), nullable=False, server_default="MANUAL"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("holidays")
    with op.batch_alter_table("session_slots") as batch:
        batch.drop_column("profile_source")
        batch.drop_column("age_band")
        batch.drop_column("gender")
    with op.batch_alter_table("visit_sessions") as batch:
        batch.drop_column("context_source")
        batch.drop_column("relationship")
        batch.drop_column("purpose")
    with op.batch_alter_table("store_tables") as batch:
        batch.drop_column("orientation")
    with op.batch_alter_table("stores") as batch:
        batch.drop_column("floor_fixtures")
