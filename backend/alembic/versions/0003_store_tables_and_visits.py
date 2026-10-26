"""Add store_tables and visit_sessions tables

Revision ID: 0003_store_tables_and_visits
Revises: 0002_ingredients_and_recipes
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_store_tables_and_visits"
down_revision: str | None = "0002_ingredients_and_recipes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "store_tables",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("seats", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("grid_x", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("grid_y", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_store_tables_store_id", "store_tables", ["store_id"])
    op.create_index("ix_store_tables_is_active", "store_tables", ["is_active"])

    op.create_table(
        "visit_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "store_id",
            sa.String(length=36),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "table_id",
            sa.String(length=36),
            sa.ForeignKey("store_tables.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("party_size", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("age_band", sa.String(length=32), nullable=False, server_default="UNRECORDED"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="SEATED"),
        sa.Column("seated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="manual"),
        sa.Column("notes", sa.String(length=200), nullable=True),
    )
    op.create_index("ix_visit_sessions_store_id", "visit_sessions", ["store_id"])
    op.create_index("ix_visit_sessions_table_id", "visit_sessions", ["table_id"])
    op.create_index("ix_visit_sessions_status", "visit_sessions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_visit_sessions_status", table_name="visit_sessions")
    op.drop_index("ix_visit_sessions_table_id", table_name="visit_sessions")
    op.drop_index("ix_visit_sessions_store_id", table_name="visit_sessions")
    op.drop_table("visit_sessions")
    op.drop_index("ix_store_tables_is_active", table_name="store_tables")
    op.drop_index("ix_store_tables_store_id", table_name="store_tables")
    op.drop_table("store_tables")
