"""Ingredient purchase unit 'pack' becomes 'ea' (U-51)

Revision ID: 0012_ingredient_units
Revises: 0011_menu_categories
Create Date: 2026-11-14

Units are now only kg/g/L/ml/ea and the server converts them. Existing 'pack' rows are
temporary data, so they become 'ea' with conversion factor 1 (user decision).

ingredients has FORCE ROW LEVEL SECURITY, so each store is updated under that store's scope.
The downgrade does not restore 'pack' (the old factor is not kept).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_ingredient_units"
down_revision: str | None = "0011_menu_categories"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    postgres = bind.dialect.name == "postgresql"
    for store_id in bind.execute(sa.text("SELECT id FROM stores")).scalars().all():
        if postgres:
            bind.execute(
                sa.text("SELECT set_config('app.current_store_id', :s, true)"),
                {"s": str(store_id)},
            )
        bind.execute(
            sa.text(
                "UPDATE ingredients SET purchase_unit = 'ea', conversion_factor = 1 "
                "WHERE store_id = :s AND purchase_unit NOT IN ('kg', 'g', 'L', 'ml', 'ea')"
            ),
            {"s": store_id},
        )


def downgrade() -> None:
    pass
