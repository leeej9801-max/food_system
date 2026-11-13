import json
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import AuditEvent, MenuCategory, MenuItem, Store, StoreTable, utcnow
from app.db.tenancy import RequestContext, bind_store_scope
from app.repositories import audit as audit_repo
from app.repositories import menu_categories as category_repo
from app.repositories import menus as menu_repo
from app.repositories import pos_mappings as pos_mapping_repo
from app.repositories import sales_orders as sales_order_repo
from app.repositories import stores as store_repo
from app.schemas import (
    MenuCategoryCreate,
    MenuCategoryResponse,
    MenuCreate,
    MenuResponse,
    MenuUpdate,
    StoreCreate,
    StoreUpdate,
)


def record_audit(
    db: Session,
    *,
    store_id: UUID,
    entity_type: str,
    entity_id: UUID,
    action: str,
    summary: dict[str, Any],
    actor: str = "local_operator",  # PROVISIONAL (P-05): 인증 도입 전 로컬 운영자 기본값
) -> None:
    event = AuditEvent(
        store_id=store_id,
        actor=actor,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        change_summary=json.dumps(summary, ensure_ascii=False, default=str),
    )
    audit_repo.add(db, event)


def get_linked_menu_ids(db: Session, *, store_id: UUID) -> set[UUID]:
    mapped_ids = set(pos_mapping_repo.list_menu_ids(db, store_id))
    sold_ids = set(sales_order_repo.list_sold_menu_ids(db, store_id))
    return {m_id for m_id in (mapped_ids | sold_ids) if m_id is not None}


def _retroactive_link_unmapped_sales(db: Session, *, store_id: UUID, menu_item: MenuItem) -> int:
    if not menu_item.is_active:
        return 0
    normalized_name = menu_item.name.strip().casefold()
    unmapped_items = sales_order_repo.list_unmapped_items(db, store_id)
    linked_count = 0
    for s_item in unmapped_items:
        if s_item.raw_product_name.strip().casefold() == normalized_name:
            s_item.menu_item_id = menu_item.id
            s_item.mapping_status = "MAPPED"
            linked_count += 1
    return linked_count


def to_menu_response(item: MenuItem, *, is_pos_linked: bool = False) -> MenuResponse:
    recipe = item.recipe
    if recipe is None or len(recipe.items) == 0:
        recipe_status: Literal["UNREGISTERED", "PARTIAL", "COMPLETE"] = "UNREGISTERED"
        recipe_count = 0
    else:
        recipe_status = "PARTIAL" if recipe.status == "PARTIAL" else "COMPLETE"
        recipe_count = len(recipe.items)
    pos_status: Literal["LINKED", "UNLINKED_PROVISIONAL"] = (
        "LINKED" if is_pos_linked else "UNLINKED_PROVISIONAL"
    )
    return MenuResponse(
        id=item.id,
        store_id=item.store_id,
        name=item.name,
        selling_price=item.selling_price,
        category=item.category,
        description=item.description,
        is_active=item.is_active,
        pos_mapping_status=pos_status,
        recipe_status=recipe_status,
        recipe_item_count=recipe_count,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def list_stores(db: Session) -> list[Store]:
    return store_repo.list_all(db)


def get_store_or_404(db: Session, store_id: UUID) -> Store:
    store = store_repo.get(db, store_id)
    if store is None:
        raise AppError(status_code=404, code="STORE_NOT_FOUND", message="매장을 찾을 수 없습니다.")
    return store


def create_store(db: Session, payload: StoreCreate) -> Store:
    store = Store(
        name=payload.name,
        timezone=payload.timezone,
        business_days=payload.business_days,
        opening_hours=payload.opening_hours,
    )
    store_repo.insert(db, store)
    # 새 매장의 테이블·감사 로그는 그 매장 범위에서 써야 RLS를 통과한다 (ADR-013)
    bind_store_scope(db, RequestContext(store_id=store.id))

    for idx in range(payload.initial_table_count):
        col = idx % 3
        row = idx // 3
        table = StoreTable(
            store_id=store.id,
            name=f"T{idx + 1}",
            seats=payload.default_seats,
            grid_x=col,
            grid_y=row,
            is_active=True,
        )
        store_repo.add_table(db, table)

    record_audit(
        db,
        store_id=store.id,
        entity_type="store",
        entity_id=store.id,
        action="created",
        summary={
            "after": {
                "name": store.name,
                "timezone": store.timezone,
                "initial_table_count": payload.initial_table_count,
            }
        },
    )
    db.commit()
    db.refresh(store)
    return store


def update_store(db: Session, store_id: UUID, payload: StoreUpdate) -> Store:
    store = get_store_or_404(db, store_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        return store
    before = {
        "name": store.name,
        "timezone": store.timezone,
        "business_days": store.business_days,
        "opening_hours": store.opening_hours,
    }
    for k, v in data.items():
        if k in ("name", "timezone") and v is None:
            continue
        setattr(store, k, v)
    store.updated_at = utcnow()
    after = {
        "name": store.name,
        "timezone": store.timezone,
        "business_days": store.business_days,
        "opening_hours": store.opening_hours,
    }
    record_audit(
        db,
        store_id=store.id,
        entity_type="store",
        entity_id=store.id,
        action="updated",
        summary={"before": before, "after": after},
    )
    db.commit()
    db.refresh(store)
    return store


def _ensure_no_duplicate_active_menu_name(
    db: Session,
    *,
    store_id: UUID,
    name: str,
    exclude_menu_id: UUID | None = None,
) -> None:
    """PROVISIONAL (P-01): 동일 매장의 활성 메뉴 중 이름(공백 제거·대소문자 무시) 중복 시 409 거절."""
    normalized = name.strip().casefold()
    existing = menu_repo.find_active_by_name(db, store_id, normalized, exclude_menu_id)
    if existing is not None:
        raise AppError(
            status_code=409,
            code="DUPLICATE_MENU_NAME",
            message=f"이미 동일한 이름의 활성 메뉴('{existing.name}')가 존재합니다.",
            details=[{"field": "name", "message": "활성 메뉴 이름이 중복됩니다."}],
        )


def list_menus(
    db: Session,
    *,
    store_id: UUID,
    q: str | None = None,
    category: str | None = None,
    status: Literal["active", "inactive", "all"] = "all",
) -> list[MenuItem]:
    get_store_or_404(db, store_id)
    return menu_repo.search(db, store_id, q=q, category=category, status=status)


def get_menu_or_404(db: Session, *, store_id: UUID, menu_id: UUID) -> MenuItem:
    get_store_or_404(db, store_id)
    item = menu_repo.find_with_recipe(db, store_id, menu_id)
    if item is None:
        raise AppError(status_code=404, code="MENU_NOT_FOUND", message="메뉴를 찾을 수 없습니다.")
    return item


def create_menu(db: Session, *, store_id: UUID, payload: MenuCreate) -> MenuItem:
    get_store_or_404(db, store_id)
    if payload.is_active:
        _ensure_no_duplicate_active_menu_name(db, store_id=store_id, name=payload.name)

    item = MenuItem(
        store_id=store_id,
        name=payload.name,
        selling_price=payload.selling_price,
        category=payload.category,
        description=payload.description,
        is_active=payload.is_active,
    )
    _ensure_category(db, store_id=store_id, name=item.category)
    menu_repo.insert(db, item)
    retro_linked = _retroactive_link_unmapped_sales(db, store_id=store_id, menu_item=item)
    record_audit(
        db,
        store_id=store_id,
        entity_type="menu_item",
        entity_id=item.id,
        action="created",
        summary={
            "after": {
                "name": item.name,
                "selling_price": item.selling_price,
                "category": item.category,
                "is_active": item.is_active,
                "retroactive_linked_sales_items": retro_linked,
            }
        },
    )
    db.commit()
    return get_menu_or_404(db, store_id=store_id, menu_id=item.id)


def update_menu(db: Session, *, store_id: UUID, menu_id: UUID, payload: MenuUpdate) -> MenuItem:
    item = get_menu_or_404(db, store_id=store_id, menu_id=menu_id)
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return item

    next_name = update_data.get("name", item.name)
    if next_name is None:
        raise AppError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="메뉴명은 비워둘 수 없습니다.",
            details=[{"field": "name", "message": "메뉴명은 필수입니다."}],
        )
    next_is_active = update_data.get("is_active", item.is_active)
    if next_is_active is None:
        next_is_active = item.is_active

    if next_is_active:
        _ensure_no_duplicate_active_menu_name(
            db,
            store_id=store_id,
            name=next_name,
            exclude_menu_id=item.id,
        )

    before_snapshot = {
        "name": item.name,
        "selling_price": item.selling_price,
        "category": item.category,
        "description": item.description,
        "is_active": item.is_active,
    }

    for field, value in update_data.items():
        if field == "is_active" and value is None:
            continue
        setattr(item, field, value)
    item.updated_at = utcnow()
    _ensure_category(db, store_id=store_id, name=item.category)
    db.flush()

    retro_linked = _retroactive_link_unmapped_sales(db, store_id=store_id, menu_item=item)

    after_snapshot = {
        "name": item.name,
        "selling_price": item.selling_price,
        "category": item.category,
        "description": item.description,
        "is_active": item.is_active,
        "retroactive_linked_sales_items": retro_linked,
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
        entity_type="menu_item",
        entity_id=item.id,
        action=action,
        summary={"before": before_snapshot, "after": after_snapshot},
    )
    db.commit()
    return get_menu_or_404(db, store_id=store_id, menu_id=item.id)


def _ensure_category(db: Session, *, store_id: UUID, name: str | None) -> None:
    """메뉴에 처음 쓰인 유형은 유형 목록에도 남긴다 (U-49)."""
    if name and category_repo.find_by_name(db, store_id, name) is None:
        category_repo.insert(db, MenuCategory(store_id=store_id, name=name))


def list_categories(db: Session, *, store_id: UUID) -> list[MenuCategoryResponse]:
    get_store_or_404(db, store_id)
    counts: dict[str, int] = {}
    for item in menu_repo.list_by_store(db, store_id):
        if item.category:
            counts[item.category] = counts.get(item.category, 0) + 1
    return [
        MenuCategoryResponse(id=c.id, name=c.name, menu_count=counts.get(c.name, 0))
        for c in category_repo.list_by_store(db, store_id)
    ]


def create_category(
    db: Session, *, store_id: UUID, payload: MenuCategoryCreate
) -> MenuCategoryResponse:
    get_store_or_404(db, store_id)
    if category_repo.find_by_name(db, store_id, payload.name) is not None:
        raise AppError(
            status_code=409,
            code="DUPLICATE_MENU_CATEGORY",
            message=f"이미 있는 메뉴 유형입니다: {payload.name}",
            details=[{"field": "name", "message": "메뉴 유형 이름이 중복됩니다."}],
        )
    category = MenuCategory(store_id=store_id, name=payload.name)
    category_repo.insert(db, category)
    record_audit(
        db,
        store_id=store_id,
        entity_type="menu_category",
        entity_id=category.id,
        action="created",
        summary={"after": {"name": category.name}},
    )
    db.commit()
    return MenuCategoryResponse(id=category.id, name=category.name, menu_count=0)


def delete_menu(db: Session, *, store_id: UUID, menu_id: UUID) -> MenuItem | None:
    """판매·POS 기록이 있으면 지우지 않고 출시대기로 돌려 그 메뉴를 돌려준다. 지웠으면 None (U-49)."""
    item = get_menu_or_404(db, store_id=store_id, menu_id=menu_id)
    snapshot = {"name": item.name, "category": item.category, "is_active": item.is_active}
    if sales_order_repo.menu_has_items(db, store_id, menu_id) or pos_mapping_repo.menu_has_mapping(
        db, store_id, menu_id
    ):
        item.is_active = False
        item.updated_at = utcnow()
        action = "deactivated_instead_of_delete"
        kept: MenuItem | None = item
    else:
        menu_repo.delete(db, item)
        action = "deleted"
        kept = None
    record_audit(
        db,
        store_id=store_id,
        entity_type="menu_item",
        entity_id=menu_id,
        action=action,
        summary={"before": snapshot},
    )
    db.commit()
    return None if kept is None else get_menu_or_404(db, store_id=store_id, menu_id=menu_id)
