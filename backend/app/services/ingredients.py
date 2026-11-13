from typing import Literal
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Ingredient, Recipe, RecipeItem, utcnow
from app.repositories import ingredients as ingredient_repo
from app.repositories import menus as menu_repo
from app.schemas import (
    IngredientCreate,
    IngredientResponse,
    IngredientUpdate,
    IngredientUsageItem,
    RecipeItemResponse,
    RecipeResponse,
    RecipeUpsertRequest,
)
from app.services.menus import get_menu_or_404, get_store_or_404, record_audit


def _ensure_no_duplicate_active_ingredient_name(
    db: Session,
    *,
    store_id: UUID,
    name: str,
    exclude_ingredient_id: UUID | None = None,
) -> None:
    normalized = name.strip().casefold()
    existing = ingredient_repo.find_active_by_name(db, store_id, normalized, exclude_ingredient_id)
    if existing is not None:
        raise AppError(
            status_code=409,
            code="DUPLICATE_INGREDIENT_NAME",
            message=f"이미 동일한 이름의 활성 식자재('{existing.name}')가 존재합니다.",
            details=[{"field": "name", "message": "활성 식자재 이름이 중복됩니다."}],
        )


def _to_ingredient_response(item: Ingredient) -> IngredientResponse:
    return IngredientResponse(
        id=item.id,
        store_id=item.store_id,
        name=item.name,
        base_unit=item.base_unit,
        purchase_unit=item.purchase_unit,
        conversion_factor=item.conversion_factor,
        safety_stock=item.safety_stock,
        notes=item.notes,
        is_active=item.is_active,
        linked_menu_count=len(item.recipe_items),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def list_ingredients(
    db: Session,
    *,
    store_id: UUID,
    q: str | None = None,
    status: Literal["active", "inactive", "all"] = "all",
) -> list[IngredientResponse]:
    get_store_or_404(db, store_id)
    items = ingredient_repo.search(db, store_id, q=q, status=status)
    return [_to_ingredient_response(item) for item in items]


def get_ingredient_or_404(db: Session, *, store_id: UUID, ingredient_id: UUID) -> Ingredient:
    get_store_or_404(db, store_id)
    item = ingredient_repo.find_with_recipe_items(db, store_id, ingredient_id)
    if item is None:
        raise AppError(
            status_code=404,
            code="INGREDIENT_NOT_FOUND",
            message="식자재를 찾을 수 없습니다.",
        )
    return item


def get_ingredient_response(
    db: Session, *, store_id: UUID, ingredient_id: UUID
) -> IngredientResponse:
    item = get_ingredient_or_404(db, store_id=store_id, ingredient_id=ingredient_id)
    return _to_ingredient_response(item)


def create_ingredient(
    db: Session, *, store_id: UUID, payload: IngredientCreate
) -> IngredientResponse:
    get_store_or_404(db, store_id)
    if payload.is_active:
        _ensure_no_duplicate_active_ingredient_name(db, store_id=store_id, name=payload.name)

    item = Ingredient(
        store_id=store_id,
        name=payload.name,
        base_unit=payload.base_unit,
        purchase_unit=payload.purchase_unit,
        conversion_factor=payload.conversion_factor,
        safety_stock=payload.safety_stock,
        notes=payload.notes,
        is_active=payload.is_active,
    )
    ingredient_repo.insert(db, item)
    record_audit(
        db,
        store_id=store_id,
        entity_type="ingredient",
        entity_id=item.id,
        action="created",
        summary={
            "after": {
                "name": item.name,
                "base_unit": item.base_unit,
                "purchase_unit": item.purchase_unit,
                "conversion_factor": item.conversion_factor,
                "is_active": item.is_active,
            }
        },
    )
    db.commit()
    return get_ingredient_response(db, store_id=store_id, ingredient_id=item.id)


def update_ingredient(
    db: Session, *, store_id: UUID, ingredient_id: UUID, payload: IngredientUpdate
) -> IngredientResponse:
    item = get_ingredient_or_404(db, store_id=store_id, ingredient_id=ingredient_id)
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return _to_ingredient_response(item)

    next_name = update_data.get("name", item.name)
    if next_name is None:
        raise AppError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="식자재명은 비워둘 수 없습니다.",
            details=[{"field": "name", "message": "식자재명은 필수입니다."}],
        )
    next_is_active = update_data.get("is_active", item.is_active)
    if next_is_active is None:
        next_is_active = item.is_active

    if next_is_active:
        _ensure_no_duplicate_active_ingredient_name(
            db,
            store_id=store_id,
            name=next_name,
            exclude_ingredient_id=item.id,
        )

    before_snapshot = {
        "name": item.name,
        "base_unit": item.base_unit,
        "purchase_unit": item.purchase_unit,
        "conversion_factor": item.conversion_factor,
        "safety_stock": item.safety_stock,
        "notes": item.notes,
        "is_active": item.is_active,
    }

    for field, value in update_data.items():
        if (
            field in ("is_active", "base_unit", "purchase_unit", "conversion_factor")
            and value is None
        ):
            continue
        setattr(item, field, value)
    item.updated_at = utcnow()

    after_snapshot = {
        "name": item.name,
        "base_unit": item.base_unit,
        "purchase_unit": item.purchase_unit,
        "conversion_factor": item.conversion_factor,
        "safety_stock": item.safety_stock,
        "notes": item.notes,
        "is_active": item.is_active,
    }
    action = (
        "deactivated"
        if before_snapshot["is_active"] and not after_snapshot["is_active"]
        else "reactivated"
        if not before_snapshot["is_active"] and after_snapshot["is_active"]
        else "updated"
    )
    record_audit(
        db,
        store_id=store_id,
        entity_type="ingredient",
        entity_id=item.id,
        action=action,
        summary={"before": before_snapshot, "after": after_snapshot},
    )
    db.commit()
    return get_ingredient_response(db, store_id=store_id, ingredient_id=item.id)


def get_menu_recipe(db: Session, *, store_id: UUID, menu_id: UUID) -> RecipeResponse:
    menu = get_menu_or_404(db, store_id=store_id, menu_id=menu_id)
    recipe = menu_repo.find_recipe_with_ingredients(db, store_id, menu.id)
    if recipe is None or len(recipe.items) == 0:
        return RecipeResponse(
            menu_item_id=menu.id,
            menu_name=menu.name,
            version=recipe.version if recipe else 0,
            status="UNREGISTERED",
            effective_from=recipe.effective_from if recipe else None,
            updated_at=recipe.updated_at if recipe else None,
            items=[],
        )

    item_responses = [
        RecipeItemResponse(
            id=ri.id,
            ingredient_id=ri.ingredient_id,
            ingredient_name=ri.ingredient.name,
            ingredient_is_active=ri.ingredient.is_active,
            quantity=ri.quantity,
            unit=ri.unit,
            notes=ri.notes,
        )
        for ri in recipe.items
    ]
    status_val: Literal["UNREGISTERED", "PARTIAL", "COMPLETE"] = (
        "PARTIAL" if recipe.status == "PARTIAL" else "COMPLETE"
    )
    return RecipeResponse(
        menu_item_id=menu.id,
        menu_name=menu.name,
        version=recipe.version,
        status=status_val,
        effective_from=recipe.effective_from,
        updated_at=recipe.updated_at,
        items=item_responses,
    )


def upsert_menu_recipe(
    db: Session,
    *,
    store_id: UUID,
    menu_id: UUID,
    payload: RecipeUpsertRequest,
) -> RecipeResponse:
    menu = get_menu_or_404(db, store_id=store_id, menu_id=menu_id)

    # 중복 식자재 검증
    seen_ids: set[UUID] = set()
    for item_in in payload.items:
        if item_in.ingredient_id in seen_ids:
            raise AppError(
                status_code=422,
                code="DUPLICATE_RECIPE_INGREDIENT",
                message="동일한 메뉴 레시피에 같은 식자재를 중복 추가할 수 없습니다.",
                details=[{"field": "items", "message": "중복된 식자재가 포함되어 있습니다."}],
            )
        seen_ids.add(item_in.ingredient_id)

    # 식자재 존재 및 store_id 단일 배치 검증 (N+1 쿼리 제거)
    ingredient_map: dict[UUID, Ingredient] = {}
    if seen_ids:
        found_ings = ingredient_repo.list_by_ids(db, store_id, seen_ids)
        ingredient_map = {ing.id: ing for ing in found_ings}
        if len(ingredient_map) != len(seen_ids):
            raise AppError(
                status_code=404,
                code="INGREDIENT_NOT_FOUND",
                message="식자재를 찾을 수 없습니다.",
            )

    recipe = menu_repo.find_recipe(db, store_id, menu.id)

    before_items = (
        [
            {"ingredient_id": ri.ingredient_id, "quantity": str(ri.quantity), "unit": ri.unit}
            for ri in recipe.items
        ]
        if recipe
        else []
    )

    if recipe is None:
        recipe = Recipe(
            store_id=store_id,
            menu_item_id=menu.id,
            version=1,
            status=payload.status,
            effective_from=utcnow(),
        )
        menu_repo.insert_recipe(db, recipe)
    else:
        recipe.version += 1
        recipe.status = payload.status
        recipe.updated_at = utcnow()
        recipe.items.clear()
        db.flush()

    for item_in in payload.items:
        ing = ingredient_map[item_in.ingredient_id]
        recipe.items.append(
            RecipeItem(
                recipe_id=recipe.id,
                store_id=recipe.store_id,
                ingredient_id=ing.id,
                quantity=item_in.quantity,
                unit=ing.base_unit,
                notes=item_in.notes.strip() if item_in.notes else None,
            )
        )

    db.flush()
    after_items = [
        {"ingredient_id": ri.ingredient_id, "quantity": str(ri.quantity), "unit": ri.unit}
        for ri in recipe.items
    ]
    record_audit(
        db,
        store_id=store_id,
        entity_type="recipe",
        entity_id=recipe.id,
        action="upserted",
        summary={
            "menu_item_id": menu.id,
            "version": recipe.version,
            "status": recipe.status,
            "before_items": before_items,
            "after_items": after_items,
        },
    )
    db.commit()
    return get_menu_recipe(db, store_id=store_id, menu_id=menu.id)


def list_ingredient_usages(
    db: Session, *, store_id: UUID, ingredient_id: UUID
) -> list[IngredientUsageItem]:
    ing = get_ingredient_or_404(db, store_id=store_id, ingredient_id=ingredient_id)
    rows = menu_repo.list_recipe_items_using(db, store_id, ing)
    return [
        IngredientUsageItem(
            menu_item_id=row.recipe.menu_item.id,
            menu_name=row.recipe.menu_item.name,
            menu_is_active=row.recipe.menu_item.is_active,
            quantity=row.quantity,
            unit=row.unit,
            recipe_status=row.recipe.status,
        )
        for row in rows
    ]
