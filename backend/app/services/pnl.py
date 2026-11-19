"""월별 손익표 (WO-20261111-002). 계산은 전부 이 파일의 결정론적 코드다."""

from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import Ingredient, MenuItem, MonthlyExpense, utcnow
from app.repositories import inventory as inventory_repo
from app.repositories import monthly_expenses as expense_repo
from app.repositories import monthly_goals as goal_repo
from app.repositories import sales_orders as sales_order_repo
from app.schemas import (
    PnlComparison,
    PnlDay,
    PnlDayDetail,
    PnlDayReceipt,
    PnlDaySale,
    PnlExpensesUpdate,
    PnlGoal,
    PnlGoalUpdate,
    PnlKpi,
    PnlLine,
    PnlPeriod,
    PnlResponse,
    PnlSalesDay,
    PnlTrendPoint,
    PnlUnitComparison,
)
from app.services.menus import get_store_or_404, record_audit

REVENUE = ("revenue", "총매출")
# 지출 항목. 순서는 사장님 엑셀 "약식 손익계산"과 같다. 자동 항목은 수기로 덮어쓸 수 있다.
EXPENSE_ITEMS: list[tuple[str, str]] = [
    ("rent", "임대료(부가세 포함)"),
    ("liquor", "주류 사입비"),
    ("ingredients", "식자재 사입비"),  # 자동: 그 달 입고 금액
    ("building", "건물관리비"),
    ("labor", "직원인건비"),
    ("social_insurance", "4대보험비"),
    ("delivery_app_fee", "배민·요기요·쿠팡 수수료"),
    ("delivery_cost", "지출된 배달비용"),
    ("packaging", "포장비용 일체"),
    ("electricity", "전기세"),
    ("water", "수도세"),
    ("gas", "가스비"),
    ("water_purifier", "정수기"),
    ("security", "CCTV·캡스"),
    ("internet", "인터넷"),
    ("phone", "전화비"),
    ("pos", "포스기"),
    ("bookkeeping", "세무기장료"),
    ("advertising", "광고비"),
    ("vat", "부가세"),
    ("fire_insurance", "화재보험"),
    ("card_fee", "카드수수료"),  # 자동: 총매출 × 카드수수료율
]
OTHER = "other"  # 사장님이 이름을 붙이는 기타 항목, 여러 줄 가능
_LABELS = dict([REVENUE, *EXPENSE_ITEMS])
TREND_MONTHS = 6


def _won(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _percent(part: int, whole: int) -> Decimal | None:
    if whole == 0:
        return None
    return (Decimal(part) * 100 / Decimal(whole)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def _shift(month: str, delta: int) -> str:
    y, m = map(int, month.split("-"))
    idx = y * 12 + (m - 1) + delta
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def _bounds(month: str, tz: str) -> tuple[datetime, datetime]:
    zone = ZoneInfo(tz)
    y, m = map(int, month.split("-"))
    ny, nm = map(int, _shift(month, 1).split("-"))
    return datetime(y, m, 1, tzinfo=zone), datetime(ny, nm, 1, tzinfo=zone)


def _build(db: Session, store_id: UUID, month: str, tz: str, card_fee_percent: Decimal):
    start, end = _bounds(month, tz)
    manual = expense_repo.list_by_month(db, store_id, month)
    by_code = {r.item_code: r.amount for r in manual if r.item_code != OTHER}

    def line(code: str, label: str, auto: int | None) -> tuple[str, str, int, str]:
        if code in by_code or auto is None:
            return code, label, by_code.get(code, 0), "manual"
        return code, label, auto, "auto"

    revenue = line(
        *REVENUE,
        _won(sales_order_repo.sum_completed_sales_between(db, store_id, start, end)),
    )
    autos = {
        "ingredients": _won(inventory_repo.sum_receipt_cost_between(db, store_id, start, end)),
        "card_fee": _won(Decimal(revenue[2]) * card_fee_percent / 100),
    }
    lines = [line(code, label, autos.get(code)) for code, label in EXPENSE_ITEMS]
    lines += [
        (OTHER, r.label or "기타", r.amount, "manual") for r in manual if r.item_code == OTHER
    ]
    return revenue, lines


def _daily(
    db: Session, store_id: UUID, month: str, tz: str, card_fee_percent: Decimal
) -> list[PnlDay]:
    """달력용. 수기 값으로 덮어쓴 월 합계와는 다를 수 있다(날짜가 있는 기록만 쓴다)."""
    start, end = _bounds(month, tz)
    sales = sales_order_repo.sum_completed_sales_by_day(db, store_id, start, end, tz)
    costs = inventory_repo.sum_receipt_cost_by_day(db, store_id, start, end, tz)
    days = []
    d = start.date()
    while d < end.date():
        s = sales.get(d, Decimal(0))
        fee = s * card_fee_percent / 100
        days.append(PnlDay(date=d, revenue=_won(s), expenses=_won(costs.get(d, Decimal(0)) + fee)))
        d += timedelta(days=1)
    return days


def _to_date(days: list[PnlDay], day: int) -> PnlPeriod:
    period = days[:day]  # 짧은 지난달은 자동으로 말일까지 잘린다.
    revenue = sum(d.revenue for d in period)
    expenses = sum(d.expenses for d in period)
    return PnlPeriod(
        start=period[0].date,
        end=period[-1].date,
        revenue=revenue,
        expenses=expenses,
        operating_profit=revenue - expenses,
    )


def _unit_comparisons(
    db: Session,
    store_id: UUID,
    month: str,
    today: date,
    tz: str,
    card_fee_percent: Decimal,
    average_months: int,
) -> dict[str, PnlUnitComparison]:
    """월 수기 값은 달력 일수로 안분한다. 주간 금액은 월 손익과 같은 비용 기준이다."""
    cache: dict[
        str,
        tuple[list[tuple[str, str, int, str]], list[PnlDay], set[date], bool, dict[date, Decimal]],
    ] = {}

    def load(m: str):
        if m not in cache:
            revenue, lines = _build(db, store_id, m, tz, card_fee_percent)
            days = _daily(db, store_id, m, tz, card_fee_percent)
            start, end = _bounds(m, tz)
            receipts = inventory_repo.list_receipts_between(db, store_id, start, end)
            dates = set(
                sales_order_repo.count_completed_orders_by_day(db, store_id, start, end, tz)
            )
            dates.update(r.received_at.astimezone(ZoneInfo(tz)).date() for r in receipts)
            costs = inventory_repo.sum_receipt_cost_by_day(db, store_id, start, end, tz)
            cache[m] = (
                [revenue, *lines],
                days,
                dates,
                bool(expense_repo.list_by_month(db, store_id, m)),
                costs,
            )
        return cache[m]

    def period(start: date, end: date) -> PnlPeriod | None:
        revenue = Decimal(0)
        expenses = Decimal(0)
        has_data = False
        day = start
        while day <= end:
            rows, days, dates, manual, costs = load(day.strftime("%Y-%m"))
            # 수기 지출만 있는 날은 거래가 없는 날이다. 거래일 또는 수기 매출만 기록으로 본다.
            has_data |= day in dates or rows[0][3] == "manual"
            daily = days[day.day - 1]
            revenue += Decimal(rows[0][2]) / len(days) if rows[0][3] == "manual" else daily.revenue
            # 자동 항목은 실제 일자, 수기 항목은 달력 일수로 안분한다.
            for code, _, amount, source in rows[1:]:
                if source == "manual":
                    expenses += Decimal(amount) / len(days)
                elif code == "ingredients":
                    expenses += costs.get(day, Decimal(0))
                elif code == "card_fee":
                    base = (
                        Decimal(rows[0][2]) / len(days)
                        if rows[0][3] == "manual"
                        else Decimal(daily.revenue)
                    )
                    expenses += base * card_fee_percent / 100
            day += timedelta(days=1)
        if not has_data:
            return None
        r, e = _won(revenue), _won(expenses)
        return PnlPeriod(start=start, end=end, revenue=r, expenses=e, operating_profit=r - e)

    def average(periods: list[PnlPeriod | None]) -> PnlPeriod | None:
        if any(p is None for p in periods):
            return None
        valid = [p for p in periods if p is not None]
        r = _won(sum((Decimal(p.revenue) for p in valid), Decimal(0)) / len(valid))
        e = _won(sum((Decimal(p.expenses) for p in valid), Decimal(0)) / len(valid))
        return PnlPeriod(
            start=valid[-1].start, end=valid[0].end, revenue=r, expenses=e, operating_profit=r - e
        )

    _, end = _bounds(month, tz)
    anchor = min(today, end.date() - timedelta(days=1))
    if month > today.strftime("%Y-%m"):
        empty = PnlUnitComparison(current=None, baseline=None, baseline_count=0)
        return {key: empty for key in ("weekly", "monthly_average", "weekly_average")}
    monday = anchor - timedelta(days=anchor.weekday())
    current_week = period(monday, anchor)
    last_week = period(monday - timedelta(days=7), anchor - timedelta(days=7))
    weeks = [
        period(monday - timedelta(weeks=n), monday - timedelta(weeks=n - 1, days=1))
        for n in range(1, 5)
    ]
    months = []
    for n in range(1, average_months + 1):
        start_m, end_m = _bounds(_shift(month, -n), tz)
        months.append(period(start_m.date(), end_m.date() - timedelta(days=1)))
    month_start, _ = _bounds(month, tz)
    # 현재월도 기존 손익표와 동일하게 월 고정비 전체를 포함한다.
    rows, _, dates, manual, _ = load(month)
    r, e = rows[0][2], sum(row[2] for row in rows[1:])
    current_month = (
        PnlPeriod(
            start=month_start.date(), end=anchor, revenue=r, expenses=e, operating_profit=r - e
        )
        if dates or manual
        else None
    )
    return {
        "weekly": PnlUnitComparison(
            current=current_week, baseline=last_week, baseline_count=int(last_week is not None)
        ),
        "monthly_average": PnlUnitComparison(
            current=current_month,
            baseline=average(months),
            baseline_count=len(months) if average(months) is not None else 0,
        ),
        "weekly_average": PnlUnitComparison(
            current=current_week,
            baseline=average(weeks),
            baseline_count=len(weeks) if average(weeks) is not None else 0,
        ),
    }


def get_pnl(
    db: Session, *, store_id: UUID, month: str, now: datetime | None = None, average_months: int = 3
) -> PnlResponse:
    store = get_store_or_404(db, store_id)
    revenue, lines = _build(db, store_id, month, store.timezone, store.card_fee_percent)
    total = sum(amount for _, _, amount, _ in lines)

    trend = []
    for delta in range(-(TREND_MONTHS - 1), 1):
        m = _shift(month, delta)
        if m == month:
            r, t = revenue[2], total
        else:
            rv, ls = _build(db, store_id, m, store.timezone, store.card_fee_percent)
            r, t = rv[2], sum(amount for _, _, amount, _ in ls)
        trend.append(PnlTrendPoint(month=m, revenue=r, total_expenses=t, operating_profit=r - t))

    def to_line(row: tuple[str, str, int, str]) -> PnlLine:
        code, label, amount, source = row
        return PnlLine(
            code=code,
            label=label,
            amount=amount,
            source=source,  # type: ignore[arg-type]
            ratio_percent=_percent(amount, revenue[2]),
        )

    daily = _daily(db, store_id, month, store.timezone, store.card_fee_percent)
    today = (now or utcnow()).astimezone(ZoneInfo(store.timezone)).date()
    start, end = _bounds(month, store.timezone)
    prev_start, prev_end = _bounds(trend[-2].month, store.timezone)
    orders = sales_order_repo.count_completed_orders_by_day(
        db, store_id, start, end, store.timezone
    )
    prev_orders = sales_order_repo.count_completed_orders_by_day(
        db, store_id, prev_start, prev_end, store.timezone
    )
    previous_daily = _daily(db, store_id, trend[-2].month, store.timezone, store.card_fee_percent)
    comparison = PnlComparison(
        previous_month=trend[-2],
        to_date=None,
        previous_to_date=None,
        average_months=average_months,
        **_unit_comparisons(
            db, store_id, month, today, store.timezone, store.card_fee_percent, average_months
        ),
    )
    if month == today.strftime("%Y-%m"):
        comparison.to_date = _to_date(daily, today.day)
        comparison.previous_to_date = _to_date(
            previous_daily,
            today.day,
        )
    goal = goal_repo.get(db, store_id, month) or goal_repo.get_latest_before(db, store_id, month)
    # 두 날짜 모두 해당 날짜에 수집된 전체 기록을 쓴다. 오늘 시각으로 어제를 자르지 않는다.
    day_start = datetime.combine(
        today - timedelta(days=1), datetime.min.time(), ZoneInfo(store.timezone)
    )
    day_end = day_start + timedelta(days=2)
    recent_sales = sales_order_repo.sum_completed_sales_by_day(
        db, store_id, day_start, day_end, store.timezone
    )
    recent_orders = sales_order_repo.count_completed_orders_by_day(
        db, store_id, day_start, day_end, store.timezone
    )

    def sales_day(day: date) -> PnlSalesDay:
        return PnlSalesDay(
            date=day,
            revenue=_won(recent_sales.get(day, Decimal(0))),
            order_count=recent_orders.get(day, 0),
        )

    current_month = comparison.to_date is not None
    kpi = PnlKpi(
        order_count=sum(orders.values()),
        previous_order_count=sum(prev_orders.values()),
        to_date_order_count=sum(n for d, n in orders.items() if d.day <= today.day)
        if current_month
        else None,
        previous_to_date_order_count=sum(n for d, n in prev_orders.items() if d.day <= today.day)
        if current_month
        else None,
        previous_has_data=bool(
            prev_orders
            or any(d.revenue or d.expenses for d in previous_daily)
            or expense_repo.list_by_month(db, store_id, trend[-2].month)
        ),
        previous_to_date_has_data=bool(
            any(d.day <= today.day for d in prev_orders)
            or any(d.revenue or d.expenses for d in previous_daily[: today.day])
        )
        if current_month
        else None,
        today=sales_day(today),
        yesterday=sales_day(today - timedelta(days=1)),
    )

    return PnlResponse(
        store_id=store_id,
        month=month,
        card_fee_percent=store.card_fee_percent,
        revenue=to_line(revenue),
        expenses=[to_line(row) for row in lines],
        total_expenses=total,
        operating_profit=revenue[2] - total,
        operating_margin_percent=_percent(revenue[2] - total, revenue[2]),
        trend=trend,
        daily=daily,
        comparison=comparison,
        kpi=kpi,
        goal=PnlGoal(
            revenue_target=goal.revenue_target if goal else None,
            profit_target=goal.profit_target if goal else None,
            inherited_from=goal.month if goal and goal.month != month else None,
        ),
    )


def save_expenses(
    db: Session,
    *,
    store_id: UUID,
    month: str,
    payload: PnlExpensesUpdate,
    now: datetime | None = None,
) -> PnlResponse:
    store = get_store_or_404(db, store_id)
    rows: list[MonthlyExpense] = []
    seen: set[str] = set()
    for i, item in enumerate(payload.items):
        field = f"items.{i}.code"
        if item.code == OTHER:
            label = (item.label or "").strip()
            if not label:
                raise AppError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message="기타 항목은 이름이 필요합니다.",
                    details=[{"field": f"items.{i}.label", "message": "이름을 입력하세요."}],
                )
        elif item.code not in _LABELS:
            raise AppError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="알 수 없는 손익 항목입니다.",
                details=[{"field": field, "message": f"'{item.code}'는 없는 항목입니다."}],
            )
        elif item.code in seen:
            raise AppError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="같은 항목이 두 번 들어왔습니다.",
                details=[{"field": field, "message": "항목은 한 번만 보냅니다."}],
            )
        else:
            label = None
        seen.add(item.code)
        rows.append(
            MonthlyExpense(
                store_id=store_id,
                month=month,
                item_code=item.code,
                label=label,
                amount=item.amount,
            )
        )
    expense_repo.replace_month(db, store_id, month, rows)
    summary: dict[str, object] = {"month": month, "items": len(rows)}
    if payload.card_fee_percent is not None:
        summary["card_fee_percent"] = {
            "before": store.card_fee_percent,
            "after": payload.card_fee_percent,
        }
        store.card_fee_percent = payload.card_fee_percent.quantize(Decimal("0.01"))
        store.updated_at = utcnow()
    record_audit(
        db,
        store_id=store_id,
        entity_type="monthly_pnl",
        entity_id=store_id,
        action="updated",
        summary=summary,
    )
    db.commit()
    return get_pnl(db, store_id=store_id, month=month, now=now)


def save_goal(
    db: Session,
    *,
    store_id: UUID,
    month: str,
    payload: PnlGoalUpdate,
    now: datetime | None = None,
) -> PnlResponse:
    get_store_or_404(db, store_id)
    goal = goal_repo.upsert(
        db,
        store_id,
        month,
        revenue_target=payload.revenue_target,
        profit_target=payload.profit_target,
    )
    record_audit(
        db,
        store_id=store_id,
        entity_type="monthly_goal",
        entity_id=goal.id,
        action="updated",
        summary={"month": month, **payload.model_dump()},
    )
    db.commit()
    return get_pnl(db, store_id=store_id, month=month, now=now)


def get_day_detail(db: Session, *, store_id: UUID, day: date) -> PnlDayDetail:
    """달력 날짜 상세. _daily와 같은 기준(날짜 있는 판매·입고 + 추정 카드수수료)."""
    store = get_store_or_404(db, store_id)
    zone = ZoneInfo(store.timezone)
    start = datetime(day.year, day.month, day.day, tzinfo=zone)
    end = start + timedelta(days=1)
    rows = sales_order_repo.list_completed_sales_by_product(db, store_id, start, end)
    menu_ids = [m for m, *_ in rows if m]
    names = (
        dict(db.execute(select(MenuItem.id, MenuItem.name).where(MenuItem.id.in_(menu_ids))).all())
        if menu_ids
        else {}
    )
    sales = sorted(
        (
            PnlDaySale(
                menu_item_id=m, name=names.get(m, raw) if m else raw, quantity=q, amount=_won(t)
            )
            for m, raw, q, t in rows
        ),
        key=lambda x: -x.amount,
    )
    receipts = inventory_repo.list_receipts_between(db, store_id, start, end)
    ing_ids = {r.ingredient_id for r in receipts}
    ing_names = (
        dict(
            db.execute(
                select(Ingredient.id, Ingredient.name).where(Ingredient.id.in_(ing_ids))
            ).all()
        )
        if ing_ids
        else {}
    )
    receipt_rows = [
        PnlDayReceipt(
            id=r.id,
            ingredient_name=ing_names.get(r.ingredient_id, "삭제된 재료"),
            quantity=r.purchase_quantity,
            unit=r.purchase_unit,
            amount=_won(r.total_cost),
            received_at=r.received_at,
            supplier_name=r.supplier_name,
        )
        for r in receipts
    ]
    revenue = sum(x.amount for x in sales)
    card_fee = _won(Decimal(revenue) * store.card_fee_percent / 100)
    expenses = sum(x.amount for x in receipt_rows) + card_fee
    return PnlDayDetail(
        date=day,
        revenue=revenue,
        expenses=expenses,
        operating_profit=revenue - expenses,
        card_fee=card_fee,
        card_fee_percent=store.card_fee_percent,
        sales=sales,
        receipts=receipt_rows,
    )
