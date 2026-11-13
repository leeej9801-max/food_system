"""매장 도면 프리셋 (WO-20261105-001, U-31).

좌표계는 가로 28칸 × 세로 24칸, 1칸 ≈ 34cm. 카운터(태블릿)에서 홀을 바라본 방향이다(U-47).
테이블 크기는 방향으로 정한다:
H(가로) 4×2칸, V(세로) 2×4칸(1200×600 기준). 의자는 화면에서 테이블 바깥 1칸에 그린다.
"""

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import StoreTable, utcnow
from app.services.menus import get_store_or_404, record_audit

# 매장 A(meal love) 도면 DOCS/ilovemeal.jpg 기준. 카운터에서 홀을 바라보게 돌렸다:
# 입구·카운터 오른쪽, 소파 벽 왼쪽, 유리창 위·오른쪽. 주방은 홀 밖이라 넣지 않는다.
# (이름, x, y, 방향, 좌석) — T7·T8은 2인석(3칸으로 짧게), T9~T12는 한쪽이 소파.
MEAL_LOVE_TABLES: tuple[tuple[str, int, int, str, int], ...] = (
    ("T1", 21, 1, "V", 4),
    ("T2", 15, 1, "V", 4),
    ("T3", 9, 1, "V", 4),
    ("T4", 21, 7, "V", 4),
    ("T5", 12, 10, "H", 4),
    ("T6", 12, 16, "H", 4),
    ("T7", 7, 10, "H", 2),
    ("T8", 7, 16, "H", 2),
    ("T9", 2, 1, "V", 4),
    ("T10", 2, 6, "V", 4),
    ("T11", 2, 11, "V", 4),
    ("T12", 2, 16, "V", 4),
)

MEAL_LOVE_FIXTURES: tuple[dict[str, object], ...] = (
    {"kind": "WALL", "x": 2, "y": 0, "w": 23, "h": 1, "label": None},
    {"kind": "WALL", "x": 27, "y": 3, "w": 1, "h": 10, "label": None},
    {"kind": "ENTRANCE", "x": 27, "y": 13, "w": 1, "h": 4, "label": None},
    {"kind": "PARTITION", "x": 19, "y": 11, "w": 8, "h": 1, "label": None},
    {"kind": "WAITING", "x": 19, "y": 12, "w": 8, "h": 1, "label": None},
    {"kind": "COUNTER", "x": 21, "y": 15, "w": 6, "h": 3, "label": "카운터"},
    {"kind": "PARTITION", "x": 11, "y": 7, "w": 1, "h": 13, "label": None},
    {"kind": "SOFA", "x": 0, "y": 1, "w": 2, "h": 19, "label": None},
    # 맨 아래 줄은 주방. 홀 기록에는 안 쓰지만 도트 홀에서 주방으로 꾸민다 (U-50)
    {"kind": "KITCHEN", "x": 0, "y": 21, "w": 28, "h": 3, "label": "주방"},
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
    for name, x, y, orientation, seats in tables_spec:
        table = existing.get(name)
        if table is None:
            db.add(
                StoreTable(
                    store_id=store_id,
                    name=name,
                    seats=seats,
                    grid_x=x,
                    grid_y=y,
                    orientation=orientation,
                    is_active=True,
                )
            )
            created += 1
            continue
        if (table.grid_x, table.grid_y, table.orientation, table.seats) != (
            x,
            y,
            orientation,
            seats,
        ):
            table.grid_x, table.grid_y, table.orientation, table.seats = x, y, orientation, seats
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
