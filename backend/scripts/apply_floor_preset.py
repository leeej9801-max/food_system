"""매장 도면 프리셋을 적용한다 (WO-20261105-001). 다시 실행해도 안전하다.

    uv run python -m scripts.apply_floor_preset <store_id> [preset]

DB 접속은 DATABASE_URL을 쓴다. PostgreSQL에서는 RLS 때문에 매장 범위를 걸고 실행한다.
"""

import sys
from uuid import UUID

from app.db.session import SessionLocal
from app.db.tenancy import RequestContext, bind_store_scope
from app.services.floor import PRESETS, apply_floor_preset


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    store_id = UUID(argv[1])
    preset = argv[2] if len(argv) > 2 else "meal_love"
    if preset not in PRESETS:
        print(f"unknown preset: {preset} (available: {', '.join(PRESETS)})")
        return 2
    db = SessionLocal()
    try:
        bind_store_scope(db, RequestContext(store_id=store_id, actor="floor-preset"))
        result = apply_floor_preset(db, store_id, preset)
    finally:
        db.close()
    print(f"floor preset {preset}: created={result['created']} updated={result['updated']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
