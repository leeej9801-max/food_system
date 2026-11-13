from collections.abc import Collection
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import Ingredient


def list_by_store(db: Session, store_id: UUID, *, active_only: bool = False) -> list[Ingredient]:
    """이름순."""
    stmt = select(Ingredient).where(Ingredient.store_id == store_id)
    if active_only:
        stmt = stmt.where(Ingredient.is_active.is_(True))
    return list(db.scalars(stmt.order_by(Ingredient.name.asc())).all())


def insert(db: Session, item: Ingredient) -> None:
    db.add(item)
    db.flush()


def find_active_by_name(
    db: Session,
    store_id: UUID,
    normalized_name: str,
    exclude_ingredient_id: UUID | None = None,
) -> Ingredient | None:
    stmt = select(Ingredient).where(
        Ingredient.store_id == store_id,
        Ingredient.is_active.is_(True),
        func.lower(Ingredient.name) == normalized_name,
    )
    if exclude_ingredient_id is not None:
        stmt = stmt.where(Ingredient.id != exclude_ingredient_id)
    return db.scalars(stmt).first()


def search(
    db: Session,
    store_id: UUID,
    *,
    q: str | None = None,
    status: Literal["active", "inactive", "all"] = "all",
) -> list[Ingredient]:
    """레시피 항목까지 불러온다. 활성 먼저, 이름순."""
    stmt = (
        select(Ingredient)
        .options(selectinload(Ingredient.recipe_items))
        .where(Ingredient.store_id == store_id)
        .execution_options(populate_existing=True)
    )
    if status == "active":
        stmt = stmt.where(Ingredient.is_active.is_(True))
    elif status == "inactive":
        stmt = stmt.where(Ingredient.is_active.is_(False))
    if q:
        stmt = stmt.where(Ingredient.name.ilike(f"%{q.strip()}%"))
    return list(db.scalars(stmt.order_by(Ingredient.is_active.desc(), Ingredient.name.asc())).all())


def find_with_recipe_items(db: Session, store_id: UUID, ingredient_id: UUID) -> Ingredient | None:
    return db.scalars(
        select(Ingredient)
        .options(selectinload(Ingredient.recipe_items))
        .where(Ingredient.id == ingredient_id, Ingredient.store_id == store_id)
        .execution_options(populate_existing=True)
    ).first()


def list_by_ids(db: Session, store_id: UUID, ids: Collection[UUID]) -> list[Ingredient]:
    return list(
        db.scalars(
            select(Ingredient).where(Ingredient.store_id == store_id, Ingredient.id.in_(ids))
        ).all()
    )
