"""Add pos_connections, pos_product_mappings, import_batches, sales_orders, sales_order_items

Revision ID: 0004_pos_imports_and_sales
Revises: 0003_store_tables_and_visits
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_pos_imports_and_sales"
down_revision: str | None = "0003_store_tables_and_visits"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pos_connections",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("mode", sa.String(length=32), nullable=False, server_default="CSV_UPLOAD"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="READY_CSV"),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("latest_data_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_pos_connections_store_id", "pos_connections", ["store_id"])

    op.create_table(
        "pos_product_mappings",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("external_product_name", sa.String(length=120), nullable=False),
        sa.Column(
            "menu_item_id",
            sa.String(length=36),
            sa.ForeignKey("menu_items.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "store_id", "external_product_name", name="uq_store_ext_product_name"
        ),
    )
    op.create_index("ix_pos_product_mappings_store_id", "pos_product_mappings", ["store_id"])
    op.create_index(
        "ix_pos_product_mappings_menu_item_id", "pos_product_mappings", ["menu_item_id"]
    )

    op.create_table(
        "import_batches",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("file_name", sa.String(length=200), nullable=False),
        sa.Column("file_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="PREVIEWED"),
        sa.Column(
            "duplicate_file_warning",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("rows_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rows_valid", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rows_error", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rows_unmapped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latest_sale_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("preview_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_import_batches_store_id", "import_batches", ["store_id"])
    op.create_index("ix_import_batches_file_hash", "import_batches", ["file_hash"])

    op.create_table(
        "sales_orders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "import_batch_id",
            sa.String(length=36),
            sa.ForeignKey("import_batches.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source_mode", sa.String(length=32), nullable=False, server_default="CSV_UPLOAD"),
        sa.Column("external_order_id", sa.String(length=100), nullable=False),
        sa.Column("ordered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("time_basis", sa.String(length=32), nullable=False, server_default="order_time"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="COMPLETED"),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("store_id", "external_order_id", name="uq_store_ext_order_id"),
    )
    op.create_index("ix_sales_orders_store_id", "sales_orders", ["store_id"])

    op.create_table(
        "sales_order_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "order_id",
            sa.String(length=36),
            sa.ForeignKey("sales_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "menu_item_id",
            sa.String(length=36),
            sa.ForeignKey("menu_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("raw_product_name", sa.String(length=120), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "unit_price", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"
        ),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="COMPLETED"),
        sa.Column(
            "mapping_status", sa.String(length=24), nullable=False, server_default="UNMAPPED"
        ),
        sa.Column("ordered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sales_order_items_order_id", "sales_order_items", ["order_id"])
    op.create_index("ix_sales_order_items_store_id", "sales_order_items", ["store_id"])
    op.create_index("ix_sales_order_items_menu_item_id", "sales_order_items", ["menu_item_id"])


def downgrade() -> None:
    op.drop_index("ix_sales_order_items_menu_item_id", table_name="sales_order_items")
    op.drop_index("ix_sales_order_items_store_id", table_name="sales_order_items")
    op.drop_index("ix_sales_order_items_order_id", table_name="sales_order_items")
    op.drop_table("sales_order_items")
    op.drop_index("ix_sales_orders_store_id", table_name="sales_orders")
    op.drop_table("sales_orders")
    op.drop_index("ix_import_batches_file_hash", table_name="import_batches")
    op.drop_index("ix_import_batches_store_id", table_name="import_batches")
    op.drop_table("import_batches")
    op.drop_index(
        "ix_pos_product_mappings_menu_item_id", table_name="pos_product_mappings"
    )
    op.drop_index("ix_pos_product_mappings_store_id", table_name="pos_product_mappings")
    op.drop_table("pos_product_mappings")
    op.drop_index("ix_pos_connections_store_id", table_name="pos_connections")
    op.drop_table("pos_connections")
