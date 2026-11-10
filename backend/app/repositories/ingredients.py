from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Ingredient


def list_by_store(db: Session, store_id: str, *, active_only: bool = False) -> list[Ingredient]:
    """이름순."""
    stmt = select(Ingredient).where(Ingredient.store_id == store_id)
    if active_only:
        stmt = stmt.where(Ingredient.is_active.is_(True))
    return list(db.scalars(stmt.order_by(Ingredient.name.asc())).all())
