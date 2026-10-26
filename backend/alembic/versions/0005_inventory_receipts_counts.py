"""Add inventory_receipts, inventory_counts, inventory_adjustments

Revision ID: 0005_inventory_receipts_counts
Revises: 0004_pos_imports_and_sales
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_inventory_receipts_counts"
down_revision: str | None = "0004_pos_imports_and_sales"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "inventory_receipts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "ingredient_id",
            sa.String(length=36),
            sa.ForeignKey("ingredients.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("purchase_quantity", sa.Numeric(precision=12, scale=3), nullable=False),
        sa.Column("purchase_unit", sa.String(length=24), nullable=False),
        sa.Column("base_quantity", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("base_unit", sa.String(length=16), nullable=False),
        sa.Column("total_cost", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("unit_cost_per_purchase", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("unit_cost_per_base", sa.Numeric(precision=12, scale=4), nullable=False),
        sa.Column("supplier_name", sa.String(length=100), nullable=True),
        sa.Column("notes", sa.String(length=200), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_inventory_receipts_store_id", "inventory_receipts", ["store_id"])
    op.create_index(
        "ix_inventory_receipts_ingredient_id", "inventory_receipts", ["ingredient_id"]
    )

    op.create_table(
        "inventory_counts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "ingredient_id",
            sa.String(length=36),
            sa.ForeignKey("ingredients.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("actual_quantity", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("base_unit", sa.String(length=16), nullable=False),
        sa.Column("notes", sa.String(length=200), nullable=True),
        sa.Column("counted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_inventory_counts_store_id", "inventory_counts", ["store_id"])
    op.create_index(
        "ix_inventory_counts_ingredient_id", "inventory_counts", ["ingredient_id"]
    )

    op.create_table(
        "inventory_adjustments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "ingredient_id",
            sa.String(length=36),
            sa.ForeignKey("ingredients.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("quantity_delta", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("base_unit", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.String(length=32), nullable=False, server_default="WASTE"),
        sa.Column("notes", sa.String(length=200), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_inventory_adjustments_store_id", "inventory_adjustments", ["store_id"])
    op.create_index(
        "ix_inventory_adjustments_ingredient_id", "inventory_adjustments", ["ingredient_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_inventory_adjustments_ingredient_id", table_name="inventory_adjustments"
    )
    op.drop_index("ix_inventory_adjustments_store_id", table_name="inventory_adjustments")
    op.drop_table("inventory_adjustments")
    op.drop_index("ix_inventory_counts_ingredient_id", table_name="inventory_counts")
    op.drop_index("ix_inventory_counts_store_id", table_name="inventory_counts")
    op.drop_table("inventory_counts")
    op.drop_index(
        "ix_inventory_receipts_ingredient_id", table_name="inventory_receipts"
    )
    op.drop_index("ix_inventory_receipts_store_id", table_name="inventory_receipts")
    op.drop_table("inventory_receipts")
