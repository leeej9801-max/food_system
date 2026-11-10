from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import PosProductMapping


def list_menu_ids(db: Session, store_id: str) -> list[str]:
    return list(
        db.scalars(
            select(PosProductMapping.menu_item_id).where(PosProductMapping.store_id == store_id)
        ).all()
    )
