import json
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from random import Random
from uuid import UUID, uuid5
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    Ingredient,
    InventoryAdjustment,
    InventoryCount,
    InventoryReceipt,
    MenuItem,
    MonthlyExpense,
    MonthlyGoal,
    SalesOrder,
    SalesOrderItem,
    SessionSlot,
    Store,
    StoreTable,
    VisitSession,
    WeatherDaily,
    new_uuid,
    utcnow,
)
from app.db.models.attendance import AttendanceEvent, AttendanceShift, Staff
from app.schemas import (
    IngredientCreate,
    MenuCreate,
    RecipeItemInput,
    RecipeUpsertRequest,
)
from app.services import ingredients as ing_service
from app.services import menus as menu_service
from app.services.attendance import _opening
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
        {
            "name": "하우스 레드와인",
            "base_unit": "ml",
            "purchase_unit": "L",
            "conversion_factor": Decimal(1000),
            "safety_stock": Decimal(1500),
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
            "recipe": [
                ("하우스 레드와인", Decimal(150)),
            ],
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


def _demo_day_plans(
    index: int, opening: int, closing: int, minute: int
) -> list[tuple[int, int, int | None, int | None]]:
    """(예정 시작, 예정 종료, 실제 출근, 실제 퇴근). 시각은 매장 자정 기준 분."""
    anchor = minute // 30 * 30
    if anchor - 180 >= opening and minute < closing:
        start, end = anchor - 90, anchor - 30
        long_end = min(anchor + 60, closing)
        all_plans: list[list[tuple[int, int, int | None, int | None]]] = [
            # 홀·주방: 30분/40분 지각 후 2시간 넘게 근무 중
            [(anchor - 180, long_end, anchor - 150, None)],
            [(anchor - 180, long_end, anchor - 140, None)],
            [(start, end, start, end - 15)],
            [(start, end, start, end + 15)],
            [(anchor - 150, start, anchor - 150, start), (anchor - 60, anchor, None, None)],
        ]
        return all_plans[index]

    start = min(opening + index * 30, closing - 60)
    end = min(start + 240, closing)
    if end <= minute:
        return [(start, end, start, end)]
    return [(start, end, start if start < minute else None, None)]


def _seed_attendance(
    db: Session, store: Store, today: date, now: datetime, open_days: set[int]
) -> None:
    store_id = store.id
    staff_ids = {}
    for index, (key, name, role, color, legacy_name) in enumerate(
        (
            ("HALL", "김서윤", "HALL", "#2563eb", "샘플 홀 직원"),
            ("KITCHEN", "박도현", "KITCHEN", "#ea580c", "샘플 주방 직원"),
            ("hall-2", "최유진", "HALL", "#7c3aed", None),
            ("kitchen-2", "윤민재", "KITCHEN", "#0d9488", None),
            ("hall-3", "한지우", "HALL", "#be185d", None),
        )
    ):
        staff_id = uuid5(store_id, f"{SAMPLE}:staff:{key}")
        staff = db.get(Staff, staff_id)
        if staff is None:
            db.add(Staff(id=staff_id, store_id=store_id, name=name, role=role, color=color))
        elif staff.store_id != store_id or staff.status != "ACTIVE":
            continue
        elif staff.name == legacy_name:
            staff.name = name
        staff_ids[index] = staff_id
    db.flush()

    start, end = _opening(store) or (11 * 60, 21 * 60)
    # 근무 일정은 30분 단위이며 매장 자정을 넘길 수 없다.
    opening, closing = max(0, (start + 29) // 30 * 30), min(1440, end // 30 * 30)
    if closing - opening < 60:
        return
    first, last = today - timedelta(days=28), today + timedelta(days=14)
    scheduled = defaultdict(list)
    for shift in db.scalars(
        select(AttendanceShift)
        .where(
            AttendanceShift.store_id == store_id,
            AttendanceShift.staff_id.in_(staff_ids.values()),
            AttendanceShift.work_date.between(first, last),
        )
        .order_by(AttendanceShift.start_minute)
    ):
        scheduled[shift.work_date, shift.staff_id].append(shift)
    events = {
        row.client_event_id: row
        for row in db.scalars(
            select(AttendanceEvent).where(
                AttendanceEvent.store_id == store_id,
                AttendanceEvent.staff_id.in_(staff_ids.values()),
                AttendanceEvent.occurred_at >= datetime.combine(first, time.min, now.tzinfo),
            )
        )
    }

    for offset in range((last - first).days + 1):
        day = first + timedelta(days=offset)
        if day.weekday() not in open_days:
            continue
        midnight = datetime.combine(day, time.min, now.tzinfo)
        recorded = any(
            uuid5(shift.id, "IN") in events
            for staff_id in staff_ids.values()
            for shift in scheduled[day, staff_id]
        )
        for index, staff_id in staff_ids.items():
            existing = scheduled[day, staff_id]
            if any(
                shift.label != SAMPLE and shift.id not in _seed_shift_ids(staff_id, day)
                for shift in existing
            ):
                continue
            for shift in existing:  # 예전 시드의 "demo:bistro:v2" 라벨을 근무 유형으로 교체
                shift.label = _shift_label(shift.start_minute, shift.end_minute)
            if recorded:
                # 당일 시연을 보존하고 날짜가 지난 열린 근무만 퇴근 원본을 추가한다.
                if day < today:
                    for shift in existing:
                        entry = events.get(uuid5(shift.id, "IN"))
                        if entry is not None:
                            _add_demo_event(
                                db, shift, "OUT", midnight, shift.end_minute, now, events
                            )
                continue

            minute = now.hour * 60 + now.minute if day == now.date() else -1
            plans = _demo_day_plans(index, opening, closing, minute)
            if day < today:
                start, end, _, _ = plans[0]
                variant = (day.toordinal() + index * 3) % 17
                plans = [
                    (
                        start,
                        end,
                        start + (12 if variant == 0 else 0),
                        min(closing, end + (15 if variant == 1 else 0)),
                    )
                ]
            for slot, (start, end, clock_in, clock_out) in enumerate(plans):
                if slot < len(existing):
                    shift = existing[slot]
                    shift.start_minute, shift.end_minute = start, end
                    shift.label = _shift_label(start, end)
                else:
                    shift = AttendanceShift(
                        id=uuid5(staff_id, f"{SAMPLE}:shift:{day}:{slot}"),
                        store_id=store_id,
                        staff_id=staff_id,
                        work_date=day,
                        start_minute=start,
                        end_minute=end,
                        label=_shift_label(start, end),
                    )
                    db.add(shift)
                _add_demo_event(db, shift, "IN", midnight, clock_in, now, events)
                _add_demo_event(db, shift, "OUT", midnight, clock_out, now, events)


def _seed_shift_ids(staff_id: UUID, day: date) -> set[UUID]:
    # 시연 근무는 결정적 id로 구분한다(라벨은 화면에 보이는 근무 유형이라 표식으로 쓰지 않는다).
    return {uuid5(staff_id, f"{SAMPLE}:shift:{day}:{slot}") for slot in range(3)}


def _shift_label(start: int, end: int) -> str:
    if end <= 15 * 60:
        return "오전 타임"
    if start >= 14 * 60:
        return "오후 타임"
    return "풀타임"


def _add_demo_event(
    db: Session,
    shift: AttendanceShift,
    kind: str,
    midnight: datetime,
    minute: int | None,
    now: datetime,
    existing: dict[UUID, AttendanceEvent],
) -> None:
    event_id = uuid5(shift.id, kind)
    if minute is None or event_id in existing:
        return
    occurred_at = (midnight + timedelta(minutes=minute)).astimezone(UTC)
    if occurred_at > now:
        return
    assert shift.staff_id is not None
    db.add(
        AttendanceEvent(
            id=event_id,
            store_id=shift.store_id,
            staff_id=shift.staff_id,
            client_event_id=event_id,
            kind=kind,
            occurred_at=occurred_at,
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
    now = utcnow().astimezone(zone)
    today = today or now.date()
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
    recipe = [
        (120, 50, 30, 0, 0, 0),
        (120, 0, 15, 45, 0, 0),
        (0, 0, 0, 20, 220, 0),
        (0, 0, 0, 0, 0, 150),
    ]
    unit_costs = [Decimal(9), Decimal(32), Decimal(45), Decimal(18), Decimal(42), Decimal(18)]
    weekdays = ["월", "화", "수", "목", "금", "토", "일"]
    open_days = (
        {day.strip() for day in store.business_days.split(",")}
        if store.business_days
        else set(weekdays[1:])
    )
    open_day_indices = {i for i, day in enumerate(weekdays) if day in open_days}
    _seed_attendance(db, store, today, now, open_day_indices)
    _seed_weather(db, first, today, open_day_indices)
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
            party = rng.choices([1, 2, 3], [10, 70, 20])[0]
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
                usage = [value + Decimal(q) for value, q in zip(usage, recipe[3], strict=True)]
            db.add(order)
            table = tables[index % len(tables)]
            if party == 1:
                relationship = "ALONE"
            elif party == 2:
                relationship = rng.choices(["COUPLE", "FRIENDS", "FAMILY"], [45, 35, 20])[0]
            else:
                relationship = rng.choices(["FRIENDS", "FAMILY"], [65, 35])[0]
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
                relationship_type=relationship,
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
                        gender=rng.choices(["FEMALE", "MALE"], [55, 45])[0],
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
                        # 오늘 실사를 23시(미래)로 넣으면 이후 실제 실사가 무시된다
                        counted_at=min(
                            datetime.combine(day, time(23), zone),
                            datetime.now(zone) - timedelta(minutes=5),
                        ),
                        notes=SAMPLE,
                    )
                )
        day = next_day
    # 완료월 평균으로 월 고정액을 고정하고 현재월은 경과 일수만큼 기록한다.
    completed = [value for key, value in month_sales.items() if key != today.strftime("%Y-%m")]
    monthly_basis = Decimal(sum(completed)) / max(1, len(completed))
    db.flush()
    existing_goals = set(
        db.scalars(
            select(MonthlyGoal.month).where(
                MonthlyGoal.store_id == store_id,
                MonthlyGoal.month.in_(list(month_sales)),
            )
        ).all()
    )
    goal_step = Decimal(500_000) if monthly_basis >= Decimal(5_000_000) else Decimal(100_000)
    revenue_target = max(
        100_000,
        int(
            (monthly_basis * Decimal("1.08") / goal_step).quantize(
                Decimal(1), rounding=ROUND_HALF_UP
            )
        )
        * int(goal_step),
    )
    profit_target = max(
        10_000,
        int(
            (Decimal(revenue_target) * Decimal("0.15") / Decimal(100_000)).quantize(
                Decimal(1), rounding=ROUND_HALF_UP
            )
        )
        * 100_000,
    )
    for month in month_sales:
        if month not in existing_goals:
            db.add(
                MonthlyGoal(
                    store_id=store_id,
                    month=month,
                    revenue_target=revenue_target,
                    profit_target=profit_target,
                )
            )
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


WEATHER_SAMPLE_SOURCE = "DEMO_SEED"
_MONTHLY_AVG_TEMPS = {
    1: 0.5,
    2: 2.5,
    3: 7.5,
    4: 13.5,
    5: 18.5,
    6: 23.0,
    7: 26.8,
    8: 27.5,
    9: 22.0,
    10: 15.5,
    11: 7.5,
    12: 2.0,
}


def _seed_weather(db: Session, first: date, today: date, open_day_indices: set[int]) -> None:
    station = settings.kma_station_id.strip()
    if not station:
        return
    db.execute(
        delete(WeatherDaily).where(
            WeatherDaily.station_id == station,
            WeatherDaily.weather_date.between(first, today),
            WeatherDaily.source == WEATHER_SAMPLE_SOURCE,
        )
    )
    db.flush()
    existing = {
        row.weather_date: row
        for row in db.scalars(
            select(WeatherDaily).where(
                WeatherDaily.station_id == station,
                WeatherDaily.weather_date.between(first, today),
            )
        ).all()
    }
    weather_rng = Random(20261119)
    generated: list[WeatherDaily] = []
    day = first
    while day <= today:
        base = _MONTHLY_AVG_TEMPS[day.month]
        if day.month == 11 and day.day >= 10:
            base -= 3.5
        avg = Decimal(str(round(base + weather_rng.uniform(-4.0, 4.0), 1)))
        min_t = (avg - Decimal("4.0")).quantize(Decimal("0.1"))
        max_t = (avg + Decimal("4.5")).quantize(Decimal("0.1"))
        rain = (
            Decimal(str(round(weather_rng.uniform(2.0, 24.0), 1)))
            if weather_rng.random() < 0.2
            else Decimal("0.0")
        )
        if day not in existing:
            generated.append(
                WeatherDaily(
                    station_id=station,
                    weather_date=day,
                    avg_temp=avg,
                    min_temp=min_t,
                    max_temp=max_t,
                    precipitation_mm=rain,
                    source=WEATHER_SAMPLE_SOURCE,
                )
            )
        day += timedelta(days=1)

    if generated:
        open_existing = [row for d, row in existing.items() if d.weekday() in open_day_indices]
        open_generated = [
            row for row in generated if row.weather_date.weekday() in open_day_indices
        ]

        def band_of(temp: Decimal) -> str:
            if temp < Decimal("5"):
                return "COLD"
            if temp < Decimal("15"):
                return "COOL"
            if temp < Decimal("25"):
                return "MILD"
            return "HOT"

        all_open = open_existing + open_generated
        present_bands = {band_of(row.avg_temp) for row in all_open if row.avg_temp is not None}
        band_temps = {
            "COLD": Decimal("3.2"),
            "COOL": Decimal("10.5"),
            "MILD": Decimal("20.0"),
            "HOT": Decimal("27.4"),
        }
        reserved: set[date] = set()
        for band in present_bands:
            for row in open_generated:
                if row.avg_temp is not None and band_of(row.avg_temp) == band:
                    reserved.add(row.weather_date)
                    break
        candidates = [row for row in open_generated if row.weather_date not in reserved]
        for band in ("COLD", "COOL", "MILD", "HOT"):
            if band not in present_bands and candidates:
                target_row = candidates.pop()
                temp = band_temps[band]
                target_row.avg_temp = temp
                target_row.min_temp = temp - Decimal("4.0")
                target_row.max_temp = temp + Decimal("4.5")

        has_rain = any(
            row.precipitation_mm is not None and row.precipitation_mm >= Decimal("1")
            for row in all_open
        )
        has_dry = any(
            row.precipitation_mm is not None and row.precipitation_mm < Decimal("1")
            for row in all_open
        )
        if not has_rain and open_generated:
            open_generated[-1].precipitation_mm = Decimal("8.5")
        if not has_dry and len(open_generated) > 1:
            open_generated[0].precipitation_mm = Decimal("0.0")

        db.add_all(generated)
