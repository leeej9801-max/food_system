import json
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError
from app.db.models import (
    AuditEvent,
    MenuItem,
    PosProductMapping,
    Recipe,
    SalesOrderItem,
    Store,
    StoreTable,
    utcnow,
)
from app.schemas import MenuCreate, MenuResponse, MenuUpdate, StoreCreate, StoreUpdate


def record_audit(
    db: Session,
    *,
    store_id: str,
    entity_type: str,
    entity_id: str,
    action: str,
    summary: dict[str, Any],
) -> None:
    event = AuditEvent(
        store_id=store_id,
        actor="local_operator",  # PROVISIONAL (P-05): 인증 도입 전 로컬 운영자 기본값
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        change_summary=json.dumps(summary, ensure_ascii=False, default=str),
    )
    db.add(event)


def get_linked_menu_ids(db: Session, *, store_id: str) -> set[str]:
    mapped_ids = set(
        db.scalars(
            select(PosProductMapping.menu_item_id).where(
                PosProductMapping.store_id == store_id
            )
        ).all()
    )
    sold_ids = set(
        db.scalars(
            select(SalesOrderItem.menu_item_id)
            .where(
                SalesOrderItem.store_id == store_id,
                SalesOrderItem.menu_item_id.is_not(None),
            )
            .distinct()
        ).all()
    )
    return {m_id for m_id in (mapped_ids | sold_ids) if m_id is not None}


def _retroactive_link_unmapped_sales(
    db: Session, *, store_id: str, menu_item: MenuItem
) -> int:
    if not menu_item.is_active:
        return 0
    normalized_name = menu_item.name.strip().casefold()
    unmapped_items = list(
        db.scalars(
            select(SalesOrderItem).where(
                SalesOrderItem.store_id == store_id,
                SalesOrderItem.mapping_status == "UNMAPPED",
            )
        ).all()
    )
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
    stmt = select(Store).order_by(Store.created_at.asc())
    return list(db.scalars(stmt).all())


def get_store_or_404(db: Session, store_id: str) -> Store:
    store = db.get(Store, store_id)
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
    db.add(store)
    db.flush()

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
        db.add(table)

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


def update_store(db: Session, store_id: str, payload: StoreUpdate) -> Store:
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
    store_id: str,
    name: str,
    exclude_menu_id: str | None = None,
) -> None:
    """PROVISIONAL (P-01): 동일 매장의 활성 메뉴 중 이름(공백 제거·대소문자 무시) 중복 시 409 거절."""
    normalized = name.strip().casefold()
    stmt = select(MenuItem).where(
        MenuItem.store_id == store_id,
        MenuItem.is_active.is_(True),
        func.lower(MenuItem.name) == normalized,
    )
    if exclude_menu_id is not None:
        stmt = stmt.where(MenuItem.id != exclude_menu_id)
    existing = db.scalars(stmt).first()
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
    store_id: str,
    q: str | None = None,
    category: str | None = None,
    status: Literal["active", "inactive", "all"] = "all",
) -> list[MenuItem]:
    get_store_or_404(db, store_id)
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
        keyword = f"%{q.strip()}%"
        stmt = stmt.where(MenuItem.name.ilike(keyword))
    stmt = stmt.order_by(MenuItem.is_active.desc(), MenuItem.name.asc())
    return list(db.scalars(stmt).all())


def get_menu_or_404(db: Session, *, store_id: str, menu_id: str) -> MenuItem:
    get_store_or_404(db, store_id)
    stmt = (
        select(MenuItem)
        .options(selectinload(MenuItem.recipe).selectinload(Recipe.items))
        .where(MenuItem.id == menu_id, MenuItem.store_id == store_id)
        .execution_options(populate_existing=True)
    )
    item = db.scalars(stmt).first()
    if item is None:
        raise AppError(status_code=404, code="MENU_NOT_FOUND", message="메뉴를 찾을 수 없습니다.")
    return item


def create_menu(db: Session, *, store_id: str, payload: MenuCreate) -> MenuItem:
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
    db.add(item)
    db.flush()
    retro_linked = _retroactive_link_unmapped_sales(
        db, store_id=store_id, menu_item=item
    )
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


def update_menu(db: Session, *, store_id: str, menu_id: str, payload: MenuUpdate) -> MenuItem:
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
    db.flush()

    retro_linked = _retroactive_link_unmapped_sales(
        db, store_id=store_id, menu_item=item
    )

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
