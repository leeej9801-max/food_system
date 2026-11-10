from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import MenuCreate, MenuResponse, MenuUpdate, RecipeResponse, RecipeUpsertRequest
from app.services import ingredients as ingredient_service
from app.services import menus as menu_service

router = APIRouter(prefix="/stores/{store_id}/menus", tags=["menus"])


@router.get("")
def get_menus(
    store_id: str,
    db: Annotated[Session, Depends(get_db)],
    q: Annotated[str | None, Query(description="메뉴명 검색어")] = None,
    category: Annotated[str | None, Query(description="카테고리 필터")] = None,
    status_filter: Annotated[
        Literal["active", "inactive", "all"], Query(alias="status", description="활성 상태 필터")
    ] = "all",
) -> list[MenuResponse]:
    items = menu_service.list_menus(
        db, store_id=store_id, q=q, category=category, status=status_filter
    )
    linked_ids = menu_service.get_linked_menu_ids(db, store_id=store_id)
    return [
        menu_service.to_menu_response(item, is_pos_linked=(item.id in linked_ids)) for item in items
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
def post_menu(
    store_id: str,
    payload: MenuCreate,
    db: Annotated[Session, Depends(get_db)],
) -> MenuResponse:
    item = menu_service.create_menu(db, store_id=store_id, payload=payload)
    linked_ids = menu_service.get_linked_menu_ids(db, store_id=store_id)
    return menu_service.to_menu_response(item, is_pos_linked=(item.id in linked_ids))


@router.get("/{menu_id}")
def get_menu(
    store_id: str,
    menu_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> MenuResponse:
    item = menu_service.get_menu_or_404(db, store_id=store_id, menu_id=menu_id)
    linked_ids = menu_service.get_linked_menu_ids(db, store_id=store_id)
    return menu_service.to_menu_response(item, is_pos_linked=(item.id in linked_ids))


@router.patch("/{menu_id}")
def patch_menu(
    store_id: str,
    menu_id: str,
    payload: MenuUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> MenuResponse:
    item = menu_service.update_menu(db, store_id=store_id, menu_id=menu_id, payload=payload)
    linked_ids = menu_service.get_linked_menu_ids(db, store_id=store_id)
    return menu_service.to_menu_response(item, is_pos_linked=(item.id in linked_ids))


@router.get("/{menu_id}/recipe")
def get_menu_recipe(
    store_id: str,
    menu_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> RecipeResponse:
    return ingredient_service.get_menu_recipe(db, store_id=store_id, menu_id=menu_id)


@router.put("/{menu_id}/recipe")
def put_menu_recipe(
    store_id: str,
    menu_id: str,
    payload: RecipeUpsertRequest,
    db: Annotated[Session, Depends(get_db)],
) -> RecipeResponse:
    return ingredient_service.upsert_menu_recipe(
        db, store_id=store_id, menu_id=menu_id, payload=payload
    )
