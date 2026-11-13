"""Floor grid 24x28 -> 28x24, rotated to the counter's view (U-47)

Revision ID: 0010_floor_counter_view
Revises: 0009_monthly_pnl
Create Date: 2026-11-13

The hall plan is now drawn as staff see it from the counter tablet: the old plan turned
90 degrees clockwise. Existing table positions and floor fixtures are rotated in place,
so a store keeps its own layout. Rect (x, y, w, h) -> (28 - (y + h), x, h, w), and table
orientation H <-> V. Old stores without a plan (legacy 0..11 x 0..7 tables, no fixtures)
are left alone; the screen still spreads them on a grid.

store_tables has FORCE ROW LEVEL SECURITY (0006), so each store's rows are updated under
that store's scope.
"""

import json
from collections.abc import Callable, Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_floor_counter_view"
down_revision: str | None = "0009_monthly_pnl"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_COLS, OLD_ROWS = 24, 28
NEW_COLS, NEW_ROWS = 28, 24


def _size(orientation: str) -> tuple[int, int]:
    return (2, 4) if orientation == "V" else (4, 2)


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def _cw(x: int, y: int, w: int, h: int) -> tuple[int, int, int, int]:
    """Old 24x28 rect -> new 28x24 rect, turned 90 degrees clockwise."""
    return OLD_ROWS - (y + h), x, h, w


def _ccw(x: int, y: int, w: int, h: int) -> tuple[int, int, int, int]:
    """New 28x24 rect -> old 24x28 rect (inverse of _cw)."""
    return y, NEW_COLS - (x + w), h, w


Rect = tuple[int, int, int, int]


def _rotate(rotate: Callable[[int, int, int, int], Rect], cols: int, rows: int) -> None:
    bind = op.get_bind()
    postgres = bind.dialect.name == "postgresql"
    stores = bind.execute(sa.text("SELECT id, floor_fixtures FROM stores")).all()
    for store_id, fixtures_json in stores:
        if postgres:
            bind.execute(
                sa.text("SELECT set_config('app.current_store_id', :s, true)"),
                {"s": str(store_id)},
            )
        tables = bind.execute(
            sa.text("SELECT id, grid_x, grid_y, orientation FROM store_tables WHERE store_id = :s"),
            {"s": store_id},
        ).all()
        legacy = not fixtures_json and all(x <= 11 and y <= 7 for _, x, y, _ in tables)
        if legacy:
            continue
        for table_id, x, y, orientation in tables:
            nx, ny, nw, nh = rotate(x, y, *_size(orientation))
            bind.execute(
                sa.text(
                    "UPDATE store_tables SET grid_x = :x, grid_y = :y, orientation = :o "
                    "WHERE id = :id"
                ),
                {
                    "x": _clamp(nx, 0, cols - nw),
                    "y": _clamp(ny, 0, rows - nh),
                    "o": "H" if orientation == "V" else "V",
                    "id": table_id,
                },
            )
        if fixtures_json:
            turned = []
            for f in json.loads(fixtures_json):
                nx, ny, nw, nh = rotate(f["x"], f["y"], f["w"], f["h"])
                turned.append(
                    {
                        **f,
                        "x": _clamp(nx, 0, cols - 1),
                        "y": _clamp(ny, 0, rows - 1),
                        "w": nw,
                        "h": nh,
                    }
                )
            bind.execute(
                sa.text("UPDATE stores SET floor_fixtures = :f WHERE id = :s"),
                {"f": json.dumps(turned, ensure_ascii=False), "s": store_id},
            )


def upgrade() -> None:
    _rotate(_cw, NEW_COLS, NEW_ROWS)


def downgrade() -> None:
    _rotate(_ccw, OLD_COLS, OLD_ROWS)
