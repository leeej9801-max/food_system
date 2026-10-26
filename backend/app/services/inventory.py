from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError
from app.db.models import (
    Ingredient,
    InventoryAdjustment,
    InventoryCount,
    InventoryReceipt,
    Recipe,
    SalesOrder,
    utcnow,
)
from app.schemas import (
    AdjustmentReasonType,
    IngredientInventoryItem,
    InventoryAdjustmentCreate,
    InventoryAdjustmentResponse,
    InventoryCountCreate,
    InventoryCountResponse,
    InventoryReceiptCreate,
    InventoryReceiptResponse,
    StockAlertStatusType,
)
from app.services.ingredients import get_ingredient_or_404
from app.services.menus import get_store_or_404, record_audit


def _norm_dt(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def create_receipt(
    db: Session, *, store_id: str, payload: InventoryReceiptCreate
) -> InventoryReceiptResponse:
    ingredient = get_ingredient_or_404(
        db, store_id=store_id, ingredient_id=payload.ingredient_id
    )
    conv = Decimal(str(ingredient.conversion_factor))
    p_qty = Decimal(str(payload.purchase_quantity)).quantize(Decimal("0.001"))
    b_qty = (p_qty * conv).quantize(Decimal("0.001"))
    t_cost = Decimal(str(payload.total_cost)).quantize(Decimal("0.01"))

    if b_qty <= 0:
        raise AppError(
            status_code=422,
            code="INVALID_BASE_QUANTITY",
            message="환산된 기본 단위 입고 수량은 0보다 커야 합니다.",
        )

    u_cost_purchase = (t_cost / p_qty).quantize(Decimal("0.01"))
    u_cost_base = (t_cost / b_qty).quantize(Decimal("0.0001"))

    receipt = InventoryReceipt(
        store_id=store_id,
        ingredient_id=ingredient.id,
        purchase_quantity=p_qty,
        purchase_unit=ingredient.purchase_unit,
        base_quantity=b_qty,
        base_unit=ingredient.base_unit,
        total_cost=t_cost,
        unit_cost_per_purchase=u_cost_purchase,
        unit_cost_per_base=u_cost_base,
        supplier_name=payload.supplier_name.strip() if payload.supplier_name else None,
        notes=payload.notes.strip() if payload.notes else None,
        received_at=utcnow(),
    )
    db.add(receipt)
    db.flush()
    record_audit(
        db,
        store_id=store_id,
        entity_type="inventory_receipt",
        entity_id=receipt.id,
        action="created",
        summary={
            "ingredient_name": ingredient.name,
            "purchase_quantity": str(p_qty),
            "purchase_unit": ingredient.purchase_unit,
            "base_quantity": str(b_qty),
            "base_unit": ingredient.base_unit,
            "total_cost": str(t_cost),
            "unit_cost_per_base": str(u_cost_base),
        },
    )
    db.commit()
    db.refresh(receipt)

    return InventoryReceiptResponse(
        id=receipt.id,
        store_id=receipt.store_id,
        ingredient_id=ingredient.id,
        ingredient_name=ingredient.name,
        purchase_quantity=Decimal(str(receipt.purchase_quantity)),
        purchase_unit=receipt.purchase_unit,
        base_quantity=Decimal(str(receipt.base_quantity)),
        base_unit=receipt.base_unit,
        total_cost=Decimal(str(receipt.total_cost)),
        unit_cost_per_purchase=Decimal(str(receipt.unit_cost_per_purchase)),
        unit_cost_per_base=Decimal(str(receipt.unit_cost_per_base)),
        supplier_name=receipt.supplier_name,
        notes=receipt.notes,
        received_at=receipt.received_at,
    )


def list_receipts(
    db: Session, *, store_id: str, ingredient_id: str | None = None
) -> list[InventoryReceiptResponse]:
    get_store_or_404(db, store_id)
    ingredients_by_id = {
        i.id: i.name
        for i in db.scalars(
            select(Ingredient).where(Ingredient.store_id == store_id)
        ).all()
    }
    stmt = select(InventoryReceipt).where(InventoryReceipt.store_id == store_id)
    if ingredient_id:
        stmt = stmt.where(InventoryReceipt.ingredient_id == ingredient_id)
    stmt = stmt.order_by(InventoryReceipt.received_at.desc(), InventoryReceipt.id.desc())
    rows = list(db.scalars(stmt).all())
    return [
        InventoryReceiptResponse(
            id=r.id,
            store_id=r.store_id,
            ingredient_id=r.ingredient_id,
            ingredient_name=ingredients_by_id.get(r.ingredient_id, ""),
            purchase_quantity=Decimal(str(r.purchase_quantity)),
            purchase_unit=r.purchase_unit,
            base_quantity=Decimal(str(r.base_quantity)),
            base_unit=r.base_unit,
            total_cost=Decimal(str(r.total_cost)),
            unit_cost_per_purchase=Decimal(str(r.unit_cost_per_purchase)),
            unit_cost_per_base=Decimal(str(r.unit_cost_per_base)),
            supplier_name=r.supplier_name,
            notes=r.notes,
            received_at=r.received_at,
        )
        for r in rows
    ]


def create_count(
    db: Session, *, store_id: str, payload: InventoryCountCreate
) -> InventoryCountResponse:
    ingredient = get_ingredient_or_404(
        db, store_id=store_id, ingredient_id=payload.ingredient_id
    )
    actual_qty = Decimal(str(payload.actual_quantity)).quantize(Decimal("0.001"))
    count_row = InventoryCount(
        store_id=store_id,
        ingredient_id=ingredient.id,
        actual_quantity=actual_qty,
        base_unit=ingredient.base_unit,
        notes=payload.notes.strip() if payload.notes else None,
        counted_at=utcnow(),
    )
    db.add(count_row)
    db.flush()
    record_audit(
        db,
        store_id=store_id,
        entity_type="inventory_count",
        entity_id=count_row.id,
        action="counted",
        summary={
            "ingredient_name": ingredient.name,
            "actual_quantity": str(actual_qty),
            "base_unit": ingredient.base_unit,
        },
    )
    db.commit()
    db.refresh(count_row)

    return InventoryCountResponse(
        id=count_row.id,
        store_id=count_row.store_id,
        ingredient_id=ingredient.id,
        ingredient_name=ingredient.name,
        actual_quantity=Decimal(str(count_row.actual_quantity)),
        base_unit=count_row.base_unit,
        notes=count_row.notes,
        counted_at=count_row.counted_at,
    )


def list_counts(
    db: Session, *, store_id: str, ingredient_id: str | None = None
) -> list[InventoryCountResponse]:
    get_store_or_404(db, store_id)
    ingredients_by_id = {
        i.id: i.name
        for i in db.scalars(
            select(Ingredient).where(Ingredient.store_id == store_id)
        ).all()
    }
    stmt = select(InventoryCount).where(InventoryCount.store_id == store_id)
    if ingredient_id:
        stmt = stmt.where(InventoryCount.ingredient_id == ingredient_id)
    stmt = stmt.order_by(InventoryCount.counted_at.desc(), InventoryCount.id.desc())
    rows = list(db.scalars(stmt).all())
    return [
        InventoryCountResponse(
            id=c.id,
            store_id=c.store_id,
            ingredient_id=c.ingredient_id,
            ingredient_name=ingredients_by_id.get(c.ingredient_id, ""),
            actual_quantity=Decimal(str(c.actual_quantity)),
            base_unit=c.base_unit,
            notes=c.notes,
            counted_at=c.counted_at,
        )
        for c in rows
    ]


def create_adjustment(
    db: Session, *, store_id: str, payload: InventoryAdjustmentCreate
) -> InventoryAdjustmentResponse:
    ingredient = get_ingredient_or_404(
        db, store_id=store_id, ingredient_id=payload.ingredient_id
    )
    delta = Decimal(str(payload.quantity_delta)).quantize(Decimal("0.001"))
    if delta == 0:
        raise AppError(
            status_code=422,
            code="ZERO_ADJUSTMENT",
            message="재고 조정 수량은 0이 될 수 없습니다.",
        )

    adj = InventoryAdjustment(
        store_id=store_id,
        ingredient_id=ingredient.id,
        quantity_delta=delta,
        base_unit=ingredient.base_unit,
        reason=payload.reason,
        notes=payload.notes.strip() if payload.notes else None,
        occurred_at=utcnow(),
    )
    db.add(adj)
    db.flush()
    record_audit(
        db,
        store_id=store_id,
        entity_type="inventory_adjustment",
        entity_id=adj.id,
        action="adjusted",
        summary={
            "ingredient_name": ingredient.name,
            "quantity_delta": str(delta),
            "reason": adj.reason,
        },
    )
    db.commit()
    db.refresh(adj)

    reason_val: AdjustmentReasonType = (
        "SPOILAGE"
        if adj.reason == "SPOILAGE"
        else "CORRECTION"
        if adj.reason == "CORRECTION"
        else "OTHER"
        if adj.reason == "OTHER"
        else "WASTE"
    )

    return InventoryAdjustmentResponse(
        id=adj.id,
        store_id=adj.store_id,
        ingredient_id=ingredient.id,
        ingredient_name=ingredient.name,
        quantity_delta=Decimal(str(adj.quantity_delta)),
        base_unit=adj.base_unit,
        reason=reason_val,
        notes=adj.notes,
        occurred_at=adj.occurred_at,
    )


def get_inventory_summary(
    db: Session, *, store_id: str, include_inactive: bool = False
) -> list[IngredientInventoryItem]:
    get_store_or_404(db, store_id)
    ing_stmt = select(Ingredient).where(Ingredient.store_id == store_id)
    if not include_inactive:
        ing_stmt = ing_stmt.where(Ingredient.is_active.is_(True))
    ing_stmt = ing_stmt.order_by(Ingredient.name.asc())
    ingredients = list(db.scalars(ing_stmt).all())

    receipts = list(
        db.scalars(
            select(InventoryReceipt)
            .where(InventoryReceipt.store_id == store_id)
            .order_by(InventoryReceipt.received_at.desc(), InventoryReceipt.id.desc())
        ).all()
    )
    counts = list(
        db.scalars(
            select(InventoryCount)
            .where(InventoryCount.store_id == store_id)
            .order_by(InventoryCount.counted_at.desc(), InventoryCount.id.desc())
        ).all()
    )
    adjustments = list(
        db.scalars(
            select(InventoryAdjustment).where(
                InventoryAdjustment.store_id == store_id
            )
        ).all()
    )

    # O(N) 사전 인덱싱으로 다수 식자재·입고·판매 건수에서도 선형 시간 보장
    receipts_by_ing: dict[str, list[InventoryReceipt]] = {}
    for r in receipts:
        receipts_by_ing.setdefault(r.ingredient_id, []).append(r)

    counts_by_ing: dict[str, list[InventoryCount]] = {}
    for c in counts:
        counts_by_ing.setdefault(c.ingredient_id, []).append(c)

    adjustments_by_ing: dict[str, list[InventoryAdjustment]] = {}
    for a in adjustments:
        adjustments_by_ing.setdefault(a.ingredient_id, []).append(a)

    # Load recipes by menu_item_id -> ingredient_id -> quantity
    recipes = list(
        db.scalars(
            select(Recipe)
            .options(selectinload(Recipe.items))
            .where(Recipe.store_id == store_id)
            .execution_options(populate_existing=True)
        ).all()
    )
    ing_menu_qty: dict[str, list[tuple[str, Decimal]]] = {}
    for rec in recipes:
        for ri in rec.items:
            ing_menu_qty.setdefault(ri.ingredient_id, []).append(
                (rec.menu_item_id, Decimal(str(ri.quantity)))
            )

    # Load completed sales orders & items
    orders = list(
        db.scalars(
            select(SalesOrder)
            .options(selectinload(SalesOrder.items))
            .where(
                SalesOrder.store_id == store_id,
                SalesOrder.status == "COMPLETED",
            )
            .execution_options(populate_existing=True)
        ).all()
    )
    sales_by_menu: dict[str, list[tuple[int, datetime, datetime | None]]] = {}
    for order in orders:
        rec_dt = _norm_dt(order.received_at) or utcnow()
        ord_dt = _norm_dt(order.ordered_at)
        for item in order.items:
            if item.status == "COMPLETED" and item.menu_item_id:
                item_ord_dt = _norm_dt(item.ordered_at) or ord_dt
                sales_by_menu.setdefault(item.menu_item_id, []).append(
                    (item.quantity, rec_dt, item_ord_dt)
                )

    result: list[IngredientInventoryItem] = []

    for ing in ingredients:
        ing_receipts = receipts_by_ing.get(ing.id, [])
        latest_receipt = ing_receipts[0] if ing_receipts else None

        ing_counts = counts_by_ing.get(ing.id, [])
        latest_count = ing_counts[0] if ing_counts else None
        baseline_dt = _norm_dt(latest_count.counted_at) if latest_count else None
        baseline_qty = (
            Decimal(str(latest_count.actual_quantity))
            if latest_count
            else Decimal("0.000")
        )

        receipts_sum = Decimal("0.000")
        for r in ing_receipts:
            r_dt = _norm_dt(r.received_at)
            if baseline_dt is None or (r_dt is not None and r_dt > baseline_dt):
                receipts_sum += Decimal(str(r.base_quantity))

        adj_sum = Decimal("0.000")
        for a in adjustments_by_ing.get(ing.id, []):
            a_dt = _norm_dt(a.occurred_at)
            if baseline_dt is None or (a_dt is not None and a_dt > baseline_dt):
                adj_sum += Decimal(str(a.quantity_delta))

        consumption_sum = Decimal("0.000")
        for menu_id, recipe_qty in ing_menu_qty.get(ing.id, []):
            for sale_qty, rec_dt, item_ord_dt in sales_by_menu.get(menu_id, []):
                if baseline_dt is not None:
                    # 실사 이전에 수집된 주문이거나, 실사일보다 과거 영업일의 지연 업로드 주문은 차감 제외
                    if rec_dt <= baseline_dt:
                        continue
                    if item_ord_dt is not None and item_ord_dt.date() < baseline_dt.date():
                        continue
                consumption_sum += recipe_qty * sale_qty

        estimated = (
            baseline_qty + receipts_sum - consumption_sum + adj_sum
        ).quantize(Decimal("0.001"))

        safety = (
            Decimal(str(ing.safety_stock)).quantize(Decimal("0.001"))
            if ing.safety_stock is not None
            else None
        )

        stock_status: StockAlertStatusType = "OK"
        if estimated < 0:
            stock_status = "NEGATIVE_WARNING"
        elif safety is not None and estimated <= safety:
            stock_status = "LOW_STOCK"

        cost_label: Literal[
            "최근 입고 단가 기준 (PROVISIONAL P-12)", "입고 단가 미등록"
        ] = (
            "최근 입고 단가 기준 (PROVISIONAL P-12)"
            if latest_receipt
            else "입고 단가 미등록"
        )

        result.append(
            IngredientInventoryItem(
                ingredient_id=ing.id,
                ingredient_name=ing.name,
                is_active=ing.is_active,
                base_unit=ing.base_unit,
                purchase_unit=ing.purchase_unit,
                conversion_factor=Decimal(str(ing.conversion_factor)),
                safety_stock=safety,
                latest_unit_cost_per_purchase=(
                    Decimal(str(latest_receipt.unit_cost_per_purchase))
                    if latest_receipt
                    else None
                ),
                latest_unit_cost_per_base=(
                    Decimal(str(latest_receipt.unit_cost_per_base))
                    if latest_receipt
                    else None
                ),
                cost_basis_label=cost_label,
                last_actual_quantity=(
                    Decimal(str(latest_count.actual_quantity))
                    if latest_count
                    else None
                ),
                last_counted_at=latest_count.counted_at if latest_count else None,
                receipts_since_count_base=receipts_sum.quantize(Decimal("0.001")),
                theoretical_consumption_base=consumption_sum.quantize(Decimal("0.001")),
                adjustments_since_count_base=adj_sum.quantize(Decimal("0.001")),
                estimated_quantity=estimated,
                stock_status=stock_status,
            )
        )

    return result
