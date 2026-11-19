import json
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from random import Random
from uuid import UUID, uuid5
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models import (
    Ingredient,
    InventoryAdjustment,
    InventoryCount,
    InventoryReceipt,
    MenuItem,
    MonthlyExpense,
    SalesOrder,
    SalesOrderItem,
    SessionSlot,
    Store,
    StoreTable,
    VisitSession,
    new_uuid,
    utcnow,
)
from app.db.models.attendance import AttendanceShift, Staff
from app.schemas import (
    IngredientCreate,
    MenuCreate,
    RecipeItemInput,
    RecipeUpsertRequest,
)
from app.services import ingredients as ing_service
from app.services import menus as menu_service
from app.services.floor import PRESETS


def seed_western_bistro_demo(
    db: Session, *, store_id: UUID, today: date | None = None
) -> dict[str, int]:
    """표시된 샘플만 교체한다. 실제 입력·수집 기록은 보존한다."""
    menu_service.get_store_or_404(db, store_id)

    demo_ingredients = [
        {
            "name": "스파게티면(데체코)",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": Decimal(1000),
            "safety_stock": Decimal(1500),
        },
        {
            "name": "관찰레(이탈리아산)",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": Decimal(1000),
            "safety_stock": Decimal(500),
        },
        {
            "name": "페코리노 로마노 치즈",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": Decimal(1000),
            "safety_stock": Decimal(400),
        },
        {
            "name": "엑스트라버진 올리브오일",
            "base_unit": "ml",
            "purchase_unit": "L",
            "conversion_factor": Decimal(1000),
            "safety_stock": Decimal(500),
        },
        {
            "name": "프라임 부채살",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": Decimal(1000),
            "safety_stock": Decimal(1000),
        },
    ]

    ing_map: dict[str, UUID] = {}
    created_ings = 0

    for item in demo_ingredients:
        existing = db.scalars(
            select(Ingredient).where(
                Ingredient.store_id == store_id,
                Ingredient.name == str(item["name"]),
            )
        ).first()
        if existing is None:
            created = ing_service.create_ingredient(
                db,
                store_id=store_id,
                payload=IngredientCreate(
                    name=str(item["name"]),
                    base_unit=item["base_unit"],  # type: ignore[arg-type]
                    purchase_unit=item["purchase_unit"],  # type: ignore[arg-type]
                    conversion_factor=Decimal(str(item["conversion_factor"])),
                    safety_stock=Decimal(str(item["safety_stock"])),
                ),
            )
            ing_id = created.id
            created_ings += 1
        else:
            ing_id = existing.id
        ing_map[str(item["name"])] = ing_id

    demo_menus = [
        {
            "name": "까르보나라",
            "category": "파스타",
            "selling_price": Decimal(16000),
            "recipe": [
                ("스파게티면(데체코)", Decimal(120)),
                ("관찰레(이탈리아산)", Decimal(50)),
                ("페코리노 로마노 치즈", Decimal(30)),
            ],
        },
        {
            "name": "알리오올리오",
            "category": "파스타",
            "selling_price": Decimal(14000),
            "recipe": [
                ("스파게티면(데체코)", Decimal(120)),
                ("엑스트라버진 올리브오일", Decimal(45)),
                ("페코리노 로마노 치즈", Decimal(15)),
            ],
        },
        {
            "name": "부채살 스테이크",
            "category": "스테이크",
            "selling_price": Decimal(29000),
            "recipe": [
                ("프라임 부채살", Decimal(220)),
                ("엑스트라버진 올리브오일", Decimal(20)),
            ],
        },
        {
            "name": "하우스 와인(글라스)",
            "category": "음료/와인",
            "selling_price": Decimal(9000),
            "recipe": [],
        },
    ]

    created_menus = 0
    menu_ids: list[UUID] = []
    for m_item in demo_menus:
        existing_menu = db.scalars(
            select(MenuItem).where(
                MenuItem.store_id == store_id,
                MenuItem.name == str(m_item["name"]),
            )
        ).first()
        if existing_menu is None:
            created_m = menu_service.create_menu(
                db,
                store_id=store_id,
                payload=MenuCreate(
                    name=str(m_item["name"]),
                    category=str(m_item["category"]),
                    selling_price=Decimal(str(m_item["selling_price"])),
                    is_active=True,
                ),
            )
            menu_id = created_m.id
            created_menus += 1
        else:
            menu_id = existing_menu.id
        menu_ids.append(menu_id)

        recipe_tuples: list[tuple[str, Decimal]] = m_item["recipe"]  # type: ignore[assignment]
        if recipe_tuples:
            ing_service.upsert_menu_recipe(
                db,
                store_id=store_id,
                menu_id=menu_id,
                payload=RecipeUpsertRequest(
                    items=[
                        RecipeItemInput(
                            ingredient_id=ing_map[ing_name],
                            quantity=qty,
                        )
                        for ing_name, qty in recipe_tuples
                    ]
                ),
            )

    activity = _seed_activity(db, store_id, list(ing_map.values()), menu_ids, today=today)
    return {
        "ingredients_created": created_ings,
        "menus_created": created_menus,
        **activity,
    }


SAMPLE = "demo:bistro:v2"


def _seed_attendance(db: Session, store_id: UUID, today: date, open_days: set[int]) -> None:
    for role, name, color, start, end in (
        ("HALL", "샘플 홀 직원", "#2563eb", 11, 20),
        ("KITCHEN", "샘플 주방 직원", "#ea580c", 10, 19),
    ):
        staff_id = uuid5(store_id, f"{SAMPLE}:staff:{role}")
        staff = db.get(Staff, staff_id)
        if staff is None:
            db.add(Staff(id=staff_id, store_id=store_id, name=name, role=role, color=color))
            db.flush()
        elif staff.status != "ACTIVE":
            continue
        first = today - timedelta(days=7)
        last = today + timedelta(days=7)
        scheduled = set(
            db.scalars(
                select(AttendanceShift.work_date).where(
                    AttendanceShift.store_id == store_id,
                    AttendanceShift.staff_id == staff_id,
                    AttendanceShift.work_date.between(first, last),
                )
            )
        )
        for offset in range(15):
            day = first + timedelta(days=offset)
            if day.weekday() in open_days and day not in scheduled:
                db.add(
                    AttendanceShift(
                        store_id=store_id,
                        staff_id=staff_id,
                        work_date=day,
                        start_minute=start * 60,
                        end_minute=end * 60,
                        label=SAMPLE,
                    )
                )


def _seed_floor(db: Session, store: Store) -> list[StoreTable]:
    tables = list(
        db.scalars(
            select(StoreTable).where(StoreTable.store_id == store.id).order_by(StoreTable.name)
        )
    )
    tables_spec, fixtures = PRESETS["meal_love"]
    preset_fixtures = json.dumps(fixtures, ensure_ascii=False)
    if store.floor_fixtures in (None, "", "[]"):
        store.floor_fixtures = preset_fixtures
    active = [table for table in tables if table.is_active]
    if active:
        by_name = {table.name: table for table in active}
        # 기존 위저드의 축약 좌표는 도면을 켜면 겹친다. 기본 배치만 옮기고 테이블 ID는 유지한다.
        if (
            store.floor_fixtures == preset_fixtures
            and len(active) <= len(tables_spec)
            and all(
                (table := by_name.get(f"T{i + 1}")) is not None
                and (table.grid_x, table.grid_y, table.orientation) == (i % 3, i // 3, "H")
                for i in range(len(active))
            )
        ):
            for name, x, y, orientation, _ in tables_spec[: len(active)]:
                table = by_name[name]
                table.grid_x, table.grid_y, table.orientation = x, y, orientation
        return active
    existing_names = {table.name for table in tables}
    for name, x, y, orientation, seats in tables_spec:
        active.append(
            StoreTable(
                store_id=store.id,
                name=f"샘플 {name}" if name in existing_names else name,
                seats=seats,
                grid_x=x,
                grid_y=y,
                orientation=orientation,
            )
        )
    db.add_all(active)
    db.flush()
    return sorted(active, key=lambda table: table.name)


def _seed_activity(
    db: Session,
    store_id: UUID,
    ingredient_ids: list[UUID],
    menu_ids: list[UUID],
    *,
    today: date | None,
) -> dict[str, int]:
    store = menu_service.get_store_or_404(db, store_id)
    # 같은 매장 샘플 교체가 겹치지 않도록 잠근다.
    db.refresh(store, with_for_update=True)
    zone = ZoneInfo(store.timezone)
    today = today or utcnow().astimezone(zone).date()
    month_index = today.year * 12 + today.month - 1 - 6
    first = date(month_index // 12, month_index % 12 + 1, 1)
    rng = Random(20261118)
    order_ids = list(
        db.scalars(
            select(SalesOrder.id).where(
                SalesOrder.store_id == store_id, SalesOrder.source_mode == SAMPLE
            )
        ).all()
    )
    if order_ids:
        db.execute(
            delete(SalesOrderItem)
            .where(SalesOrderItem.store_id == store_id, SalesOrderItem.order_id.in_(order_ids))
            .execution_options(synchronize_session=False)
        )
    db.execute(
        delete(SalesOrder).where(SalesOrder.store_id == store_id, SalesOrder.source_mode == SAMPLE)
    )
    visit_ids = list(
        db.scalars(
            select(VisitSession.id).where(
                VisitSession.store_id == store_id, VisitSession.source == SAMPLE
            )
        ).all()
    )
    if visit_ids:
        db.execute(
            delete(SessionSlot)
            .where(SessionSlot.store_id == store_id, SessionSlot.session_id.in_(visit_ids))
            .execution_options(synchronize_session=False)
        )
    db.execute(
        delete(VisitSession).where(VisitSession.store_id == store_id, VisitSession.source == SAMPLE)
    )
    for model in (InventoryReceipt, InventoryCount, InventoryAdjustment):
        db.execute(delete(model).where(model.store_id == store_id, model.notes == SAMPLE))
    db.execute(
        delete(MonthlyExpense).where(
            MonthlyExpense.store_id == store_id, MonthlyExpense.label == SAMPLE
        )
    )
    # 이전 마스터 전용 샘플 입고도 교체한다.
    db.execute(
        delete(InventoryReceipt).where(
            InventoryReceipt.store_id == store_id,
            InventoryReceipt.notes == "프로토타입 초기 입고 단가",
            InventoryReceipt.supplier_name == "유로푸드 파트너스(프로토타입)",
        )
    )
    tables = _seed_floor(db, store)
    ingredients = [db.get(Ingredient, ident) for ident in ingredient_ids]
    menus = [db.get(MenuItem, ident) for ident in menu_ids]
    assert all(ingredients) and all(menus)
    recipe = [(120, 50, 30, 0, 0), (120, 0, 15, 45, 0), (0, 0, 0, 20, 220), (0, 0, 0, 0, 0)]
    unit_costs = [Decimal(9), Decimal(32), Decimal(45), Decimal(18), Decimal(42)]
    weekdays = ["월", "화", "수", "목", "금", "토", "일"]
    open_days = (
        {day.strip() for day in store.business_days.split(",")}
        if store.business_days
        else set(weekdays[1:])
    )
    _seed_attendance(db, store_id, today, {i for i, day in enumerate(weekdays) if day in open_days})
    month_sales: dict[str, int] = {}
    receipts = orders = visits = 0
    day = first
    while day <= today:
        month = day.strftime("%Y-%m")
        month_sales.setdefault(month, 0)
        if weekdays[day.weekday()] not in open_days:
            day += timedelta(days=1)
            continue
        daily_sales = 0
        usage = [Decimal(0) for _ in ingredients]
        parties = (27 if day.weekday() >= 4 else 20) + rng.randint(-2, 2)
        for index in range(parties):
            party = rng.choices([1, 2, 3], [2, 7, 1])[0]
            hour = [11, 12, 18, 19, 13, 17, 20][index // len(tables) % 7]
            at = datetime.combine(day, time(hour, index % len(tables) * 3 % 60), zone)
            order = SalesOrder(
                store_id=store_id,
                source_mode=SAMPLE,
                external_order_id=f"{SAMPLE}:{day}:{index}",
                ordered_at=at,
                received_at=at,
                status="COMPLETED",
            )
            for _ in range(party):
                pick = rng.choices([0, 1, 2], [45, 35, 20])[0]
                menu = menus[pick]
                assert menu is not None
                price = (
                    menu.selling_price
                    if menu.selling_price is not None
                    else Decimal([16000, 14000, 29000][pick])
                )
                order.items.append(
                    SalesOrderItem(
                        store_id=store_id,
                        menu_item_id=menu.id,
                        raw_product_name=menu.name,
                        quantity=1,
                        unit_price=price,
                        status="COMPLETED",
                        mapping_status="MAPPED",
                        ordered_at=at,
                    )
                )
                daily_sales += int(price)
                usage = [value + Decimal(q) for value, q in zip(usage, recipe[pick], strict=True)]
            if rng.random() < 0.3:
                menu = menus[3]
                assert menu is not None
                price = menu.selling_price if menu.selling_price is not None else Decimal(9000)
                order.items.append(
                    SalesOrderItem(
                        store_id=store_id,
                        menu_item_id=menu.id,
                        raw_product_name=menu.name,
                        quantity=1,
                        unit_price=price,
                        status="COMPLETED",
                        mapping_status="MAPPED",
                        ordered_at=at,
                    )
                )
                daily_sales += int(price)
            db.add(order)
            table = tables[index % len(tables)]
            visit = VisitSession(
                id=new_uuid(),
                store_id=store_id,
                table_id=table.id,
                party_size=party,
                age_band=rng.choice(["20S", "30S", "40S"]),
                status="LEFT",
                seated_at=at,
                paid_at=at + timedelta(minutes=45),
                left_at=at + timedelta(minutes=55),
                source=SAMPLE,
                notes=SAMPLE,
                closed_reason="CLEARED",
                relationship_type=rng.choice(["FRIENDS", "FAMILY", "COUPLE"]),
                context_source="STAFF",
            )
            db.add(visit)
            for slot in range(party):
                db.add(
                    SessionSlot(
                        store_id=store_id,
                        session_id=visit.id,
                        slot_no=slot + 1,
                        state="SILHOUETTE",
                        age_band=visit.age_band,
                        gender="UNRECORDED",
                        profile_source="STAFF",
                        created_at=at,
                        updated_at=at,
                    )
                )
            orders += 1
            visits += 1
        month_sales[month] += daily_sales
        total_weight = sum(
            (q * cost for q, cost in zip(usage, unit_costs, strict=True)), Decimal(0)
        )
        target_cost = (Decimal(daily_sales) * Decimal("0.32")).quantize(
            Decimal(1), rounding=ROUND_HALF_UP
        )
        allocated = Decimal(0)
        active = [i for i, q in enumerate(usage) if q > 0]
        for i in active:
            ingredient = ingredients[i]
            assert ingredient is not None
            quantity = usage[i]
            if receipts < len(ingredients):
                quantity += (ingredient.safety_stock or Decimal(0)) * 2
            cost = (
                target_cost - allocated
                if i == active[-1]
                else (target_cost * usage[i] * unit_costs[i] / total_weight).quantize(
                    Decimal(1), rounding=ROUND_HALF_UP
                )
            )
            allocated += cost
            purchase = (quantity / ingredient.conversion_factor).quantize(Decimal("0.001"))
            quantity = purchase * ingredient.conversion_factor
            db.add(
                InventoryReceipt(
                    store_id=store_id,
                    ingredient_id=ingredient.id,
                    purchase_quantity=purchase,
                    purchase_unit=ingredient.purchase_unit,
                    base_quantity=quantity,
                    base_unit=ingredient.base_unit,
                    total_cost=cost,
                    unit_cost_per_purchase=(cost / purchase).quantize(Decimal("0.01")),
                    unit_cost_per_base=(cost / quantity).quantize(Decimal("0.0001")),
                    received_at=datetime.combine(day, time(9), zone),
                    supplier_name="샘플 식자재 공급처",
                    notes=SAMPLE,
                )
            )
            receipts += 1
        next_day = day + timedelta(days=1)
        if next_day.month != day.month or day == today:
            for ingredient in ingredients:
                assert ingredient is not None
                db.add(
                    InventoryCount(
                        store_id=store_id,
                        ingredient_id=ingredient.id,
                        actual_quantity=(ingredient.safety_stock or Decimal(0)) * 2,
                        base_unit=ingredient.base_unit,
                        counted_at=datetime.combine(day, time(23), zone),
                        notes=SAMPLE,
                    )
                )
        day = next_day
    # 완료월 평균으로 월 고정액을 고정하고 현재월은 경과 일수만큼 기록한다.
    completed = [value for key, value in month_sales.items() if key != today.strftime("%Y-%m")]
    monthly_basis = Decimal(sum(completed)) / max(1, len(completed))
    db.flush()
    for month in month_sales:
        existing = set(
            db.scalars(
                select(MonthlyExpense.item_code).where(
                    MonthlyExpense.store_id == store_id, MonthlyExpense.month == month
                )
            ).all()
        )
        elapsed = Decimal(1)
        if month == today.strftime("%Y-%m"):
            next_month = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
            elapsed = Decimal(today.day) / (next_month - today.replace(day=1)).days
        for code, ratio in (
            ("rent", "0.125"),
            ("labor", "0.235"),
            ("social_insurance", "0.025"),
            ("electricity", "0.025"),
            ("gas", "0.015"),
            ("water", "0.01"),
            ("building", "0.015"),
            ("packaging", "0.01"),
            ("advertising", "0.01"),
            ("bookkeeping", "0.01"),
            ("internet", "0.005"),
            ("vat", "0.025"),
        ):
            if code not in existing:
                db.add(
                    MonthlyExpense(
                        store_id=store_id,
                        month=month,
                        item_code=code,
                        label=SAMPLE,
                        amount=int(
                            (monthly_basis * Decimal(ratio) * elapsed).quantize(
                                Decimal(1), rounding=ROUND_HALF_UP
                            )
                        ),
                    )
                )
    menu_service.record_audit(
        db,
        store_id=store_id,
        entity_type="demo_seed",
        entity_id=store_id,
        action="replaced",
        summary={"sample": SAMPLE, "start": str(first), "end": str(today), "orders": orders},
    )
    db.commit()
    return {"receipts_created": receipts, "orders_created": orders, "visits_created": visits}
