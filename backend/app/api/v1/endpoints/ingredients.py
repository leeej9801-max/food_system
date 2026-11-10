from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import (
    IngredientCreate,
    IngredientResponse,
    IngredientUpdate,
    IngredientUsageItem,
)
from app.services import ingredients as ingredient_service

router = APIRouter(prefix="/stores/{store_id}/ingredients", tags=["ingredients"])


@router.get("")
def get_ingredients(
    store_id: str,
    db: Annotated[Session, Depends(get_db)],
    q: Annotated[str | None, Query(description="식자재명 검색어")] = None,
    status_filter: Annotated[
        Literal["active", "inactive", "all"], Query(alias="status", description="활성 상태 필터")
    ] = "all",
) -> list[IngredientResponse]:
    return ingredient_service.list_ingredients(db, store_id=store_id, q=q, status=status_filter)


@router.post("", status_code=status.HTTP_201_CREATED)
def post_ingredient(
    store_id: str,
    payload: IngredientCreate,
    db: Annotated[Session, Depends(get_db)],
) -> IngredientResponse:
    return ingredient_service.create_ingredient(db, store_id=store_id, payload=payload)


@router.get("/{ingredient_id}")
def get_ingredient(
    store_id: str,
    ingredient_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> IngredientResponse:
    return ingredient_service.get_ingredient_response(
        db, store_id=store_id, ingredient_id=ingredient_id
    )


@router.patch("/{ingredient_id}")
def patch_ingredient(
    store_id: str,
    ingredient_id: str,
    payload: IngredientUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> IngredientResponse:
    return ingredient_service.update_ingredient(
        db, store_id=store_id, ingredient_id=ingredient_id, payload=payload
    )


@router.get("/{ingredient_id}/usages")
def get_ingredient_usages(
    store_id: str,
    ingredient_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> list[IngredientUsageItem]:
    return ingredient_service.list_ingredient_usages(
        db, store_id=store_id, ingredient_id=ingredient_id
    )
