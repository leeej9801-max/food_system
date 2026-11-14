from decimal import Decimal
from typing import Literal

from app.core.errors import AppError

UnitType = Literal["kg", "g", "L", "ml", "ea"]

# 입력 단위 -> (기본 단위, 1 입력 단위당 기본 단위 수)
_TO_BASE: dict[str, tuple[str, Decimal]] = {
    "kg": ("g", Decimal(1000)),
    "g": ("g", Decimal(1)),
    "L": ("ml", Decimal(1000)),
    "ml": ("ml", Decimal(1)),
    "ea": ("ea", Decimal(1)),
}


def base_of(unit: str) -> tuple[str, Decimal]:
    """단위의 기본 단위와 변환비. 모르는 단위(옛 데이터의 pack 등)는 개로 본다."""
    return _TO_BASE.get(unit, ("ea", Decimal(1)))


def factor_to(unit: str, base_unit: str) -> Decimal:
    """unit 1개가 base_unit 몇 개인지. 무게·부피·개수가 다르면 422."""
    unit_base, factor = base_of(unit)
    if unit_base != base_unit:
        raise AppError(
            status_code=422,
            code="UNIT_MISMATCH",
            message=f"{unit} 단위는 이 식자재({base_unit} 기준)에 쓸 수 없습니다.",
            details=[{"field": "unit", "message": "무게·부피·개수 단위가 다릅니다."}],
        )
    return factor
