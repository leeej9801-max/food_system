from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    InventoryReceipt,
    MenuItem,
    Recipe,
    RecipeItem,
    SalesOrder,
)
from app.schemas import (
    CostSimulationRequest,
    CostSimulationResponse,
    MenuCostIngredientBreakdown,
    MenuCostSimulationItem,
    MenuCostStatusType,
    MenuSalesRankItem,
    SalesAnalyticsResponse,
    SalesHourlyBucket,
)
from app.services.menus import get_store_or_404


def get_sales_analytics(db: Session, *, store_id: str) -> SalesAnalyticsResponse:
    get_store_or_404(db, store_id)

    menus_by_id = {
        m.id: m.name
        for m in db.scalars(
            select(MenuItem).where(MenuItem.store_id == store_id)
        ).all()
    }

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

    hourly_qty: dict[int, int] = {h: 0 for h in range(24)}
    hourly_sales: dict[int, Decimal] = {h: Decimal("0.00") for h in range(24)}
    known_hour_qty = 0
    unknown_hour_qty = 0
    total_qty = 0
    total_sales = Decimal("0.00")

    menu_agg: dict[tuple[str | None, str, str], dict[str, int | Decimal]] = {}

    for order in orders:
        has_exact_hour = (
            order.time_basis == "order_time" and order.ordered_at is not None
        )
        hour_val = order.ordered_at.hour if order.ordered_at is not None else 0

        for item in order.items:
            if item.status != "COMPLETED":
                continue
            qty = item.quantity
            line_sales = (Decimal(str(item.unit_price)) * qty).quantize(
                Decimal("0.01")
            )
            total_qty += qty
            total_sales += line_sales

            if has_exact_hour:
                known_hour_qty += qty
                hourly_qty[hour_val] += qty
                hourly_sales[hour_val] += line_sales
            else:
                unknown_hour_qty += qty

            display_name = (
                menus_by_id.get(item.menu_item_id, item.raw_product_name)
                if item.menu_item_id
                else item.raw_product_name
            )
            key = (item.menu_item_id, display_name, item.mapping_status)
            if key not in menu_agg:
                menu_agg[key] = {"qty": 0, "sales": Decimal("0.00")}
            menu_agg[key]["qty"] = int(menu_agg[key]["qty"]) + qty
            menu_agg[key]["sales"] = Decimal(str(menu_agg[key]["sales"])) + line_sales

    buckets = [
        SalesHourlyBucket(
            hour=h,
            quantity=hourly_qty[h],
            sales_amount=hourly_sales[h].quantize(Decimal("0.01")),
        )
        for h in range(24)
    ]

    rankings: list[MenuSalesRankItem] = []
    for (menu_id, name, map_status), vals in menu_agg.items():
        m_status: Literal["MAPPED", "UNMAPPED"] = (
            "MAPPED" if map_status == "MAPPED" else "UNMAPPED"
        )
        rankings.append(
            MenuSalesRankItem(
                menu_item_id=menu_id,
                menu_name=name,
                mapping_status=m_status,
                quantity=int(vals["qty"]),
                sales_amount=Decimal(str(vals["sales"])).quantize(Decimal("0.01")),
            )
        )
    rankings.sort(key=lambda r: (r.quantity, r.sales_amount), reverse=True)

    return SalesAnalyticsResponse(
        store_id=store_id,
        total_completed_orders=len(orders),
        total_quantity=total_qty,
        total_net_sales=total_sales.quantize(Decimal("0.01")),
        known_hour_quantity=known_hour_qty,
        unknown_hour_quantity=unknown_hour_qty,
        hourly_buckets=buckets,
        menu_rankings=rankings,
    )


def simulate_menu_costs(
    db: Session, *, store_id: str, payload: CostSimulationRequest
) -> CostSimulationResponse:
    get_store_or_404(db, store_id)

    menus = list(
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

    receipts = list(
        db.scalars(
            select(InventoryReceipt)
            .where(InventoryReceipt.store_id == store_id)
            .order_by(InventoryReceipt.received_at.desc(), InventoryReceipt.id.desc())
        ).all()
    )
    latest_cost_by_ing: dict[str, Decimal] = {}
    for r in receipts:
        if r.ingredient_id not in latest_cost_by_ing:
            latest_cost_by_ing[r.ingredient_id] = Decimal(str(r.unit_cost_per_base))

    global_pct = Decimal(str(payload.global_change_percent))
    sim_menus: list[MenuCostSimulationItem] = []

    for menu in menus:
        selling_price = (
            Decimal(str(menu.selling_price)).quantize(Decimal("0.01"))
            if menu.selling_price is not None
            else None
        )
        recipe = menu.recipe
        if recipe is None or len(recipe.items) == 0:
            sim_menus.append(
                MenuCostSimulationItem(
                    menu_item_id=menu.id,
                    menu_name=menu.name,
                    category=menu.category,
                    selling_price=selling_price,
                    cost_status="NO_RECIPE",
                    missing_cost_ingredients=[],
                    base_recipe_cost=Decimal("0.00"),
                    simulated_recipe_cost=Decimal("0.00"),
                    cost_delta=Decimal("0.00"),
                    base_margin=selling_price,
                    simulated_margin=selling_price,
                    base_cost_ratio_percent=None,
                    simulated_cost_ratio_percent=None,
                    high_cost_warning=False,
                    breakdown=[],
                )
            )
            continue

        missing_ings: list[str] = []
        base_total = Decimal("0.00")
        sim_total = Decimal("0.00")
        breakdown: list[MenuCostIngredientBreakdown] = []

        for ri in recipe.items:
            ing = ri.ingredient
            qty = Decimal(str(ri.quantity)).quantize(Decimal("0.001"))
            base_u_cost = latest_cost_by_ing.get(ri.ingredient_id)
            if base_u_cost is None:
                missing_ings.append(ing.name)
                breakdown.append(
                    MenuCostIngredientBreakdown(
                        ingredient_id=ri.ingredient_id,
                        ingredient_name=ing.name,
                        quantity=qty,
                        base_unit=ri.unit,
                        base_unit_cost=None,
                        simulated_unit_cost=None,
                        base_line_cost=None,
                        simulated_line_cost=None,
                    )
                )
                continue

            pct = Decimal(
                str(
                    payload.ingredient_change_percents.get(
                        ri.ingredient_id, global_pct
                    )
                )
            )
            mult = max(Decimal(0), Decimal(1) + (pct / Decimal(100)))
            sim_u_cost = (base_u_cost * mult).quantize(Decimal("0.0001"))
            b_line = (base_u_cost * qty).quantize(Decimal("0.01"))
            s_line = (sim_u_cost * qty).quantize(Decimal("0.01"))

            base_total += b_line
            sim_total += s_line
            breakdown.append(
                MenuCostIngredientBreakdown(
                    ingredient_id=ri.ingredient_id,
                    ingredient_name=ing.name,
                    quantity=qty,
                    base_unit=ri.unit,
                    base_unit_cost=base_u_cost,
                    simulated_unit_cost=sim_u_cost,
                    base_line_cost=b_line,
                    simulated_line_cost=s_line,
                )
            )

        cost_status: MenuCostStatusType = (
            "INCOMPLETE_COST" if missing_ings else "COMPLETE"
        )
        base_margin = (
            (selling_price - base_total).quantize(Decimal("0.01"))
            if selling_price is not None
            else None
        )
        sim_margin = (
            (selling_price - sim_total).quantize(Decimal("0.01"))
            if selling_price is not None
            else None
        )
        base_ratio = (
            ((base_total / selling_price) * Decimal(100)).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            if selling_price is not None and selling_price > 0
            else None
        )
        sim_ratio = (
            ((sim_total / selling_price) * Decimal(100)).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            if selling_price is not None and selling_price > 0
            else None
        )
        high_warning = sim_ratio is not None and sim_ratio >= Decimal("35.00")

        sim_menus.append(
            MenuCostSimulationItem(
                menu_item_id=menu.id,
                menu_name=menu.name,
                category=menu.category,
                selling_price=selling_price,
                cost_status=cost_status,
                missing_cost_ingredients=missing_ings,
                base_recipe_cost=base_total.quantize(Decimal("0.01")),
                simulated_recipe_cost=sim_total.quantize(Decimal("0.01")),
                cost_delta=(sim_total - base_total).quantize(Decimal("0.01")),
                base_margin=base_margin,
                simulated_margin=sim_margin,
                base_cost_ratio_percent=base_ratio,
                simulated_cost_ratio_percent=sim_ratio,
                high_cost_warning=high_warning,
                breakdown=breakdown,
            )
        )

    return CostSimulationResponse(
        store_id=store_id,
        global_change_percent=global_pct.quantize(Decimal("0.01")),
        menus=sim_menus,
    )
