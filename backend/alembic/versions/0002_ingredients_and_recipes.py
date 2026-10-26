"""Add ingredients, recipes, recipe_items tables

Revision ID: 0002_ingredients_and_recipes
Revises: 0001_initial_menus
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_ingredients_and_recipes"
down_revision: str | None = "0001_initial_menus"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ingredients",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("base_unit", sa.String(length=16), nullable=False, server_default="g"),
        sa.Column("purchase_unit", sa.String(length=16), nullable=False, server_default="kg"),
        sa.Column(
            "conversion_factor",
            sa.Numeric(precision=12, scale=4),
            nullable=False,
            server_default="1000",
        ),
        sa.Column("safety_stock", sa.Numeric(precision=12, scale=3), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ingredients_store_id", "ingredients", ["store_id"])
    op.create_index("ix_ingredients_is_active", "ingredients", ["is_active"])

    op.create_table(
        "recipes",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "menu_item_id",
            sa.String(length=36),
            sa.ForeignKey("menu_items.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="COMPLETE"),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_recipes_store_id", "recipes", ["store_id"])
    op.create_index("ix_recipes_menu_item_id", "recipes", ["menu_item_id"])

    op.create_table(
        "recipe_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "recipe_id",
            sa.String(length=36),
            sa.ForeignKey("recipes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "ingredient_id",
            sa.String(length=36),
            sa.ForeignKey("ingredients.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Numeric(precision=12, scale=3), nullable=False),
        sa.Column("unit", sa.String(length=16), nullable=False),
        sa.Column("notes", sa.String(length=200), nullable=True),
        sa.UniqueConstraint("recipe_id", "ingredient_id", name="uq_recipe_ingredient"),
    )
    op.create_index("ix_recipe_items_recipe_id", "recipe_items", ["recipe_id"])
    op.create_index("ix_recipe_items_ingredient_id", "recipe_items", ["ingredient_id"])


def downgrade() -> None:
    op.drop_index("ix_recipe_items_ingredient_id", table_name="recipe_items")
    op.drop_index("ix_recipe_items_recipe_id", table_name="recipe_items")
    op.drop_table("recipe_items")
    op.drop_index("ix_recipes_menu_item_id", table_name="recipes")
    op.drop_index("ix_recipes_store_id", table_name="recipes")
    op.drop_table("recipes")
    op.drop_index("ix_ingredients_is_active", table_name="ingredients")
    op.drop_index("ix_ingredients_store_id", table_name="ingredients")
    op.drop_table("ingredients")
