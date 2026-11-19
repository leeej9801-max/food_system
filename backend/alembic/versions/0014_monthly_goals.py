"""Monthly P&L goals, with the monthly_expenses RLS and default grants pattern.

Revision ID: 0014_monthly_goals
Revises: 0013_weather_daily
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_monthly_goals"
down_revision: str | None = "0013_weather_daily"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "monthly_goals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("store_id", sa.Uuid(), nullable=False),
        sa.Column("month", sa.CHAR(7), nullable=False),
        sa.Column("revenue_target", sa.BigInteger(), nullable=True),
        sa.Column("profit_target", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("store_id", "month", name="monthly_goals_store_month_key"),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE monthly_goals ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE monthly_goals FORCE ROW LEVEL SECURITY")
        op.execute(
            "CREATE POLICY store_isolation ON monthly_goals "
            "USING (store_id = app_current_store_id()) "
            "WITH CHECK (store_id = app_current_store_id())"
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS store_isolation ON monthly_goals")
    op.drop_table("monthly_goals")
