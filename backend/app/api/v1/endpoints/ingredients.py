from typing import Literal

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


@router.get("", response_model=list[IngredientResponse])
def get_ingredients(
    store_id: str,
    q: str | None = Query(default=None, description="식자재명 검색어"),
    status_filter: Literal["active", "inactive", "all"] = Query(
        default="all", alias="status", description="활성 상태 필터"
    ),
    db: Session = Depends(get_db),
) -> list[IngredientResponse]:
    return ingredient_service.list_ingredients(db, store_id=store_id, q=q, status=status_filter)


@router.post("", response_model=IngredientResponse, status_code=status.HTTP_201_CREATED)
def post_ingredient(
    store_id: str,
    payload: IngredientCreate,
    db: Session = Depends(get_db),
) -> IngredientResponse:
    return ingredient_service.create_ingredient(db, store_id=store_id, payload=payload)


@router.get("/{ingredient_id}", response_model=IngredientResponse)
def get_ingredient(
    store_id: str,
    ingredient_id: str,
    db: Session = Depends(get_db),
) -> IngredientResponse:
    return ingredient_service.get_ingredient_response(
        db, store_id=store_id, ingredient_id=ingredient_id
    )


@router.patch("/{ingredient_id}", response_model=IngredientResponse)
def patch_ingredient(
    store_id: str,
    ingredient_id: str,
    payload: IngredientUpdate,
    db: Session = Depends(get_db),
) -> IngredientResponse:
    return ingredient_service.update_ingredient(
        db, store_id=store_id, ingredient_id=ingredient_id, payload=payload
    )


@router.get("/{ingredient_id}/usages", response_model=list[IngredientUsageItem])
def get_ingredient_usages(
    store_id: str,
    ingredient_id: str,
    db: Session = Depends(get_db),
) -> list[IngredientUsageItem]:
    return ingredient_service.list_ingredient_usages(
        db, store_id=store_id, ingredient_id=ingredient_id
    )
