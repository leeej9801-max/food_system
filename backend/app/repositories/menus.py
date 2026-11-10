from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import MenuItem, Recipe, RecipeItem


def list_by_store(db: Session, store_id: str) -> list[MenuItem]:
    return list(db.scalars(select(MenuItem).where(MenuItem.store_id == store_id)).all())


def list_active_with_recipes(db: Session, store_id: str) -> list[MenuItem]:
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
