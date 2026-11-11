"""월별 손익표 (WO-20261111-002). 계산은 전부 이 파일의 결정론적 코드다."""

from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import MonthlyExpense, utcnow
from app.repositories import inventory as inventory_repo
from app.repositories import monthly_expenses as expense_repo
from app.repositories import sales_orders as sales_order_repo
from app.schemas import PnlExpensesUpdate, PnlLine, PnlResponse, PnlTrendPoint
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


def get_pnl(db: Session, *, store_id: UUID, month: str) -> PnlResponse:
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
    )


def save_expenses(
    db: Session, *, store_id: UUID, month: str, payload: PnlExpensesUpdate
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
    return get_pnl(db, store_id=store_id, month=month)
