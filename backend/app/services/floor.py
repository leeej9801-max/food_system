"""매장 도면 프리셋 (WO-20261105-001, U-31).

좌표계는 가로 24칸 × 세로 28칸, 1칸 ≈ 34cm. 테이블 크기는 방향으로 정한다:
H(가로) 4×2칸, V(세로) 2×4칸(1200×600 기준). 의자는 화면에서 테이블 바깥 1칸에 그린다.
"""

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import StoreTable, utcnow
from app.services.menus import get_store_or_404, record_audit

# 매장 A(meal love) 도면 DOCS/ilovemeal.jpg를 180° 돌린 실제 방향 기준 (입구가 위).
# (이름, x, y, 방향) — 왼쪽 열 3, 왼쪽 위 1, 가운데 세로 4, 창가 아래 줄 4 = 12테이블 4인석
MEAL_LOVE_TABLES: tuple[tuple[str, int, int, str], ...] = (
    ("T1", 1, 3, "H"),
    ("T2", 1, 9, "H"),
    ("T3", 1, 15, "H"),
    ("T4", 7, 3, "H"),
    ("T5", 11, 7, "V"),
    ("T6", 15, 7, "V"),
    ("T7", 11, 15, "V"),
    ("T8", 15, 15, "V"),
    ("T9", 1, 24, "H"),
    ("T10", 7, 24, "H"),
    ("T11", 13, 24, "H"),
    ("T12", 19, 24, "H"),
)

MEAL_LOVE_FIXTURES: tuple[dict[str, object], ...] = (
    {"kind": "ENTRANCE", "x": 14, "y": 0, "w": 4, "h": 1, "label": "입구"},
    {"kind": "COUNTER", "x": 19, "y": 1, "w": 5, "h": 3, "label": "카운터"},
    {"kind": "KITCHEN", "x": 22, "y": 5, "w": 2, "h": 9, "label": "주방"},
    {"kind": "PARTITION", "x": 6, "y": 1, "w": 1, "h": 6, "label": None},
    {"kind": "PARTITION", "x": 10, "y": 13, "w": 8, "h": 1, "label": None},
    {"kind": "WALL", "x": 0, "y": 27, "w": 24, "h": 1, "label": "창"},
)

PRESETS = {"meal_love": (MEAL_LOVE_TABLES, MEAL_LOVE_FIXTURES)}


def apply_floor_preset(db: Session, store_id: UUID, preset: str = "meal_love") -> dict[str, int]:
    """프리셋 테이블을 이름 기준으로 맞춘다. 있는 테이블은 위치만 고치고, 없으면 만든다.

    프리셋에 없는 테이블은 지우거나 끄지 않는다(방문 기록 보존). 다시 실행해도 중복 생성하지 않는다.
    """
    tables_spec, fixtures = PRESETS[preset]
    store = get_store_or_404(db, store_id)
    existing = {
        t.name: t
        for t in db.scalars(select(StoreTable).where(StoreTable.store_id == store_id)).all()
    }
    created = updated = 0
    for name, x, y, orientation in tables_spec:
        table = existing.get(name)
        if table is None:
            db.add(
                StoreTable(
                    store_id=store_id,
                    name=name,
                    seats=4,
                    grid_x=x,
                    grid_y=y,
                    orientation=orientation,
                    is_active=True,
                )
            )
            created += 1
            continue
        if (table.grid_x, table.grid_y, table.orientation, table.seats) != (x, y, orientation, 4):
            table.grid_x, table.grid_y, table.orientation, table.seats = x, y, orientation, 4
            table.updated_at = utcnow()
            updated += 1
    store.floor_fixtures = json.dumps(list(fixtures), ensure_ascii=False)
    store.updated_at = utcnow()
    record_audit(
        db,
        store_id=store_id,
        entity_type="store",
        entity_id=store_id,
        action="floor_preset",
        summary={"preset": preset, "created": created, "updated": updated},
    )
    db.commit()
    return {"created": created, "updated": updated}
