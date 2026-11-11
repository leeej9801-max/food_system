from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import MenuItem, Recipe, RecipeItem


def list_by_store(db: Session, store_id: UUID) -> list[MenuItem]:
    return list(db.scalars(select(MenuItem).where(MenuItem.store_id == store_id)).all())


def list_active_with_recipes(db: Session, store_id: UUID) -> list[MenuItem]:
    """활성 메뉴를 레시피·재료까지 불러온다. 이름순."""
    return list(
        db.scalars(
            select(MenuItem)
            .options(
                selectinload(MenuItem.recipe)
                .selectinload(Recipe.items)
                .selectinload(RecipeItem.ingredient)
            )
            .where(MenuItem.store_id == store_id, MenuItem.is_active.is_(True))
            .order_by(MenuItem.name.asc())
            .execution_options(populate_existing=True)
        ).all()
    )


def list_recipes_with_items(db: Session, store_id: UUID) -> list[Recipe]:
    return list(
        db.scalars(
            select(Recipe)
            .options(selectinload(Recipe.items))
            .where(Recipe.store_id == store_id)
            .execution_options(populate_existing=True)
        ).all()
    )


def insert(db: Session, item: MenuItem) -> None:
    db.add(item)
    db.flush()


def find_active_by_name(
    db: Session, store_id: UUID, normalized_name: str, exclude_menu_id: UUID | None = None
) -> MenuItem | None:
    stmt = select(MenuItem).where(
        MenuItem.store_id == store_id,
        MenuItem.is_active.is_(True),
        func.lower(MenuItem.name) == normalized_name,
    )
    if exclude_menu_id is not None:
        stmt = stmt.where(MenuItem.id != exclude_menu_id)
    return db.scalars(stmt).first()


def search(
    db: Session,
    store_id: UUID,
    *,
    q: str | None = None,
    category: str | None = None,
    status: Literal["active", "inactive", "all"] = "all",
) -> list[MenuItem]:
    """레시피까지 불러온다. 활성 먼저, 이름순."""
    stmt = (
        select(MenuItem)
        .options(selectinload(MenuItem.recipe).selectinload(Recipe.items))
        .where(MenuItem.store_id == store_id)
        .execution_options(populate_existing=True)
    )
    if status == "active":
        stmt = stmt.where(MenuItem.is_active.is_(True))
    elif status == "inactive":
        stmt = stmt.where(MenuItem.is_active.is_(False))
    if category:
        stmt = stmt.where(MenuItem.category == category.strip())
    if q:
        stmt = stmt.where(MenuItem.name.ilike(f"%{q.strip()}%"))
    return list(db.scalars(stmt.order_by(MenuItem.is_active.desc(), MenuItem.name.asc())).all())


def find_with_recipe(db: Session, store_id: UUID, menu_id: UUID) -> MenuItem | None:
    return db.scalars(
        select(MenuItem)
        .options(selectinload(MenuItem.recipe).selectinload(Recipe.items))
        .where(MenuItem.id == menu_id, MenuItem.store_id == store_id)
        .execution_options(populate_existing=True)
    ).first()
