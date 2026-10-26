from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import MenuCreate, MenuResponse, MenuUpdate, RecipeResponse, RecipeUpsertRequest
from app.services import ingredients as ingredient_service
from app.services import menus as menu_service

router = APIRouter(prefix="/stores/{store_id}/menus", tags=["menus"])


@router.get("", response_model=list[MenuResponse])
def get_menus(
    store_id: str,
    q: str | None = Query(default=None, description="메뉴명 검색어"),
    category: str | None = Query(default=None, description="카테고리 필터"),
    status_filter: Literal["active", "inactive", "all"] = Query(
        default="all", alias="status", description="활성 상태 필터"
    ),
    db: Session = Depends(get_db),
) -> list[MenuResponse]:
    items = menu_service.list_menus(
        db, store_id=store_id, q=q, category=category, status=status_filter
    )
    linked_ids = menu_service.get_linked_menu_ids(db, store_id=store_id)
    return [
        menu_service.to_menu_response(item, is_pos_linked=(item.id in linked_ids))
        for item in items
    ]


@router.post("", response_model=MenuResponse, status_code=status.HTTP_201_CREATED)
def post_menu(
    store_id: str,
    payload: MenuCreate,
    db: Session = Depends(get_db),
) -> MenuResponse:
    item = menu_service.create_menu(db, store_id=store_id, payload=payload)
    linked_ids = menu_service.get_linked_menu_ids(db, store_id=store_id)
    return menu_service.to_menu_response(item, is_pos_linked=(item.id in linked_ids))


@router.get("/{menu_id}", response_model=MenuResponse)
def get_menu(
    store_id: str,
    menu_id: str,
    db: Session = Depends(get_db),
) -> MenuResponse:
    item = menu_service.get_menu_or_404(db, store_id=store_id, menu_id=menu_id)
    linked_ids = menu_service.get_linked_menu_ids(db, store_id=store_id)
    return menu_service.to_menu_response(item, is_pos_linked=(item.id in linked_ids))


@router.patch("/{menu_id}", response_model=MenuResponse)
def patch_menu(
    store_id: str,
    menu_id: str,
    payload: MenuUpdate,
    db: Session = Depends(get_db),
) -> MenuResponse:
    item = menu_service.update_menu(
        db, store_id=store_id, menu_id=menu_id, payload=payload
    )
    linked_ids = menu_service.get_linked_menu_ids(db, store_id=store_id)
    return menu_service.to_menu_response(item, is_pos_linked=(item.id in linked_ids))


@router.get("/{menu_id}/recipe", response_model=RecipeResponse)
def get_menu_recipe(
    store_id: str,
    menu_id: str,
    db: Session = Depends(get_db),
) -> RecipeResponse:
    return ingredient_service.get_menu_recipe(db, store_id=store_id, menu_id=menu_id)


@router.put("/{menu_id}/recipe", response_model=RecipeResponse)
def put_menu_recipe(
    store_id: str,
    menu_id: str,
    payload: RecipeUpsertRequest,
    db: Session = Depends(get_db),
) -> RecipeResponse:
    return ingredient_service.upsert_menu_recipe(
        db, store_id=store_id, menu_id=menu_id, payload=payload
    )
