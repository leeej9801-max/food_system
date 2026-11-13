"""Monthly P&L: manual expense rows and store card fee rate (WO-20261111-002)

Revision ID: 0009_monthly_pnl
Revises: 0008_floor_profile_holidays
Create Date: 2026-11-11

monthly_expenses holds store data, so it gets the same store_isolation policy as the
other store tables (ADR-013). The runtime role's default privileges cover the new table.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_monthly_pnl"
down_revision: str | None = "0008_floor_profile_holidays"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("stores") as batch:
        batch.add_column(
            sa.Column("card_fee_percent", sa.Numeric(4, 2), nullable=False, server_default="2.00")
        )
    op.create_table(
        "monthly_expenses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("store_id", sa.Uuid(), nullable=False),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("item_code", sa.String(32), nullable=False),
        sa.Column("label", sa.String(50), nullable=True),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monthly_expenses_store_month", "monthly_expenses", ["store_id", "month"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE monthly_expenses ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE monthly_expenses FORCE ROW LEVEL SECURITY")
        op.execute(
            "CREATE POLICY store_isolation ON monthly_expenses "
            "USING (store_id = app_current_store_id()) "
            "WITH CHECK (store_id = app_current_store_id())"
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS store_isolation ON monthly_expenses")
    op.drop_index("ix_monthly_expenses_store_month", table_name="monthly_expenses")
    op.drop_table("monthly_expenses")
    with op.batch_alter_table("stores") as batch:
        batch.drop_column("card_fee_percent")
