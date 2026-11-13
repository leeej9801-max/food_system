"""Menu categories kept as their own rows (U-49)

Revision ID: 0011_menu_categories
Revises: 0010_floor_counter_view
Create Date: 2026-11-14

A category now stays even when no menu uses it, so the menu screen can show it as a card.
Existing free-text menu_items.category values are copied in per store. menu_items.category
stays the link (by name) so nothing else changes.

menu_items and the new table have FORCE ROW LEVEL SECURITY, so each store is copied under
that store's scope.
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_menu_categories"
down_revision: str | None = "0010_floor_counter_view"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "menu_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("store_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("store_id", "name", name="menu_categories_store_name_key"),
    )
    bind = op.get_bind()
    postgres = bind.dialect.name == "postgresql"
    if postgres:
        op.execute("ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE menu_categories FORCE ROW LEVEL SECURITY")
        op.execute(
            "CREATE POLICY store_isolation ON menu_categories "
            "USING (store_id = app_current_store_id()) "
            "WITH CHECK (store_id = app_current_store_id())"
        )
    # 앱이 만드는 id는 uuid v7이지만, 옮겨 오는 행은 순서가 상관없어 v4로 충분하다
    store_ids = bind.execute(sa.text("SELECT id FROM stores")).scalars().all()
    for store_id in store_ids:
        if postgres:
            bind.execute(
                sa.text("SELECT set_config('app.current_store_id', :s, true)"),
                {"s": str(store_id)},
            )
        names = (
            bind.execute(
                sa.text(
                    "SELECT DISTINCT category FROM menu_items "
                    "WHERE store_id = :s AND category IS NOT NULL AND category <> ''"
                ),
                {"s": store_id},
            )
            .scalars()
            .all()
        )
        for name in sorted(names):
            bind.execute(
                sa.text(
                    "INSERT INTO menu_categories (id, store_id, name, created_at) "
                    "VALUES (:id, :s, :n, now())"
                ),
                {"id": uuid.uuid4(), "s": store_id, "n": name},
            )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS store_isolation ON menu_categories")
    op.drop_table("menu_categories")
