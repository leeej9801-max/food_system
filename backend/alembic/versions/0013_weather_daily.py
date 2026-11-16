"""Global daily weather from KMA ASOS (U-28, WO-20261116-002)

Revision ID: 0013_weather_daily
Revises: 0012_ingredient_units
Create Date: 2026-11-16

weather_daily is a global table keyed by observation station and date. It holds no store
data, so it has no store_id and no RLS (ADR-013 global table, same as holidays).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_weather_daily"
down_revision: str | None = "0012_ingredient_units"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "weather_daily",
        sa.Column("station_id", sa.String(10), primary_key=True),
        sa.Column("weather_date", sa.Date(), primary_key=True),
        sa.Column("avg_temp", sa.Numeric(4, 1), nullable=True),
        sa.Column("min_temp", sa.Numeric(4, 1), nullable=True),
        sa.Column("max_temp", sa.Numeric(4, 1), nullable=True),
        sa.Column("precipitation_mm", sa.Numeric(6, 1), nullable=True),
        sa.Column("source", sa.String(10), nullable=False, server_default="KMA_ASOS"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("weather_daily")
