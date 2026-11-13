"""Store isolation (ADR-013 B): recipe_items.store_id + PostgreSQL row-level security

Revision ID: 0006_store_isolation_rls
Revises: 0005_inventory_receipts_counts
Create Date: 2026-11-04

RLS is enforced only for a role that is neither table owner nor superuser nor BYPASSRLS
(see scripts/ensure_runtime_role.py). SQLite gets the column change only.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_store_isolation_rls"
down_revision: str | None = "0005_inventory_receipts_counts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every table that holds one store's data. `stores` itself stays readable (store picker).
TENANT_TABLES = (
    "menu_items",
    "ingredients",
    "recipes",
    "recipe_items",
    "store_tables",
    "visit_sessions",
    "pos_connections",
    "pos_product_mappings",
    "import_batches",
    "sales_orders",
    "sales_order_items",
    "inventory_receipts",
    "inventory_counts",
    "inventory_adjustments",
    "audit_events",
)

# fail-closed: no scope set -> NULL -> no rows. Must match app/db/tenancy.py STORE_SCOPE_SETTING.
SCOPE_FUNCTION = """
CREATE OR REPLACE FUNCTION app_current_store_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('app.current_store_id', true), '')::uuid $$
"""


def upgrade() -> None:
    with op.batch_alter_table("recipe_items") as batch:
        batch.add_column(sa.Column("store_id", sa.Uuid(), nullable=True))
    op.execute(
        "UPDATE recipe_items SET store_id = "
        "(SELECT recipes.store_id FROM recipes WHERE recipes.id = recipe_items.recipe_id)"
    )
    with op.batch_alter_table("recipe_items") as batch:
        batch.alter_column("store_id", existing_type=sa.Uuid(), nullable=False)
        batch.create_foreign_key(
            "fk_recipe_items_store_id", "stores", ["store_id"], ["id"], ondelete="RESTRICT"
        )
        batch.create_index("ix_recipe_items_store_id", ["store_id"])

    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(SCOPE_FUNCTION)
    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY store_isolation ON {table} "
            "USING (store_id = app_current_store_id()) "
            "WITH CHECK (store_id = app_current_store_id())"
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for table in TENANT_TABLES:
            op.execute(f"DROP POLICY IF EXISTS store_isolation ON {table}")
            op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
            op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
        op.execute("DROP FUNCTION IF EXISTS app_current_store_id()")
    with op.batch_alter_table("recipe_items") as batch:
        batch.drop_index("ix_recipe_items_store_id")
        batch.drop_constraint("fk_recipe_items_store_id", type_="foreignkey")
        batch.drop_column("store_id")
