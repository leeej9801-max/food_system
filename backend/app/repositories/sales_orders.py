from collections.abc import Collection
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session, selectinload

from app.db.models import SalesOrder, SalesOrderItem


def list_completed_with_items(db: Session, store_id: UUID) -> list[SalesOrder]:
    return list(
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


def list_sold_menu_ids(db: Session, store_id: UUID) -> list[UUID | None]:
    return list(
        db.scalars(
            select(SalesOrderItem.menu_item_id)
            .where(
                SalesOrderItem.store_id == store_id,
                SalesOrderItem.menu_item_id.is_not(None),
            )
            .distinct()
        ).all()
    )


def list_unmapped_items(db: Session, store_id: UUID) -> list[SalesOrderItem]:
    return list(
        db.scalars(
            select(SalesOrderItem).where(
                SalesOrderItem.store_id == store_id,
                SalesOrderItem.mapping_status == "UNMAPPED",
            )
        ).all()
    )


def list_recent_with_items(
    db: Session, store_id: UUID, *, limit: int | None = None
) -> list[SalesOrder]:
    """받은 시각·외부 주문번호 내림차순. limit이 없으면 전체."""
    stmt = (
        select(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .where(SalesOrder.store_id == store_id)
        .order_by(SalesOrder.received_at.desc(), SalesOrder.external_order_id.desc())
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    return list(db.scalars(stmt).all())


def integration_totals(db: Session, store_id: UUID) -> tuple[int, Decimal, int, list[str]]:
    """(완료 주문 수, 순매출, 순판매 수량, 미매핑 상품명). 주문 이력을 메모리로 올리지 않고 DB에서 집계한다."""
    orders = db.scalar(
        select(func.count(SalesOrder.id)).where(
            SalesOrder.store_id == store_id, SalesOrder.status == "COMPLETED"
        )
    )
    amount, qty = db.execute(
        select(
            func.coalesce(func.sum(SalesOrderItem.unit_price * SalesOrderItem.quantity), 0),
            func.coalesce(func.sum(SalesOrderItem.quantity), 0),
        )
        .join(SalesOrder, SalesOrder.id == SalesOrderItem.order_id)
        .where(
            SalesOrder.store_id == store_id,
            SalesOrder.status == "COMPLETED",
            SalesOrderItem.status == "COMPLETED",
        )
    ).one()
    unmapped = db.scalars(
        select(SalesOrderItem.raw_product_name)
        .join(SalesOrder, SalesOrder.id == SalesOrderItem.order_id)
        .where(SalesOrder.store_id == store_id, SalesOrderItem.mapping_status == "UNMAPPED")
        .distinct()
    ).all()
    return int(orders or 0), Decimal(str(amount)), int(qty), sorted(unmapped)


def list_by_external_ids(
    db: Session, store_id: UUID, external_ids: Collection[str]
) -> list[SalesOrder]:
    return list(
        db.scalars(
            select(SalesOrder)
            .options(selectinload(SalesOrder.items))
            .where(
                SalesOrder.store_id == store_id,
                SalesOrder.external_order_id.in_(external_ids),
            )
        ).all()
    )


def find_by_external_id(db: Session, store_id: UUID, external_id: str) -> SalesOrder | None:
    return db.scalars(
        select(SalesOrder).where(
            SalesOrder.store_id == store_id,
            SalesOrder.external_order_id == external_id,
        )
    ).first()


def find_with_items(db: Session, store_id: UUID, order_id: UUID) -> SalesOrder | None:
    return db.scalars(
        select(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .where(SalesOrder.id == order_id, SalesOrder.store_id == store_id)
    ).first()


def get_with_items(db: Session, order_id: UUID) -> SalesOrder | None:
    """매장 조건 없음. RLS가 범위를 막는다."""
    return db.scalars(
        select(SalesOrder).options(selectinload(SalesOrder.items)).where(SalesOrder.id == order_id)
    ).first()


def list_items(db: Session, store_id: UUID) -> list[SalesOrderItem]:
    return list(db.scalars(select(SalesOrderItem).where(SalesOrderItem.store_id == store_id)).all())


def insert(db: Session, order: SalesOrder) -> None:
    db.add(order)
    db.flush()


def add_item(db: Session, item: SalesOrderItem) -> None:
    db.add(item)


def delete_item(db: Session, item: SalesOrderItem) -> None:
    db.delete(item)


def sum_completed_sales_between(
    db: Session, store_id: UUID, start: datetime, end: datetime
) -> Decimal:
    """완료 주문의 완료 품목 금액 합. 주문 시각이 없으면 수신 시각으로 본다."""
    when = func.coalesce(SalesOrder.ordered_at, SalesOrder.received_at)
    total = db.scalar(
        select(func.sum(SalesOrderItem.unit_price * SalesOrderItem.quantity))
        .join(SalesOrder, SalesOrderItem.order_id == SalesOrder.id)
        .where(
            SalesOrder.store_id == store_id,
            SalesOrder.status == "COMPLETED",
            SalesOrderItem.status == "COMPLETED",
            when >= start,
            when < end,
        )
    )
    return total or Decimal(0)


def sum_completed_sales_by_day(
    db: Session, store_id: UUID, start: datetime, end: datetime, tz: str
) -> dict[date, Decimal]:
    """sum_completed_sales_between을 매장 시간대 날짜별로 나눈 값."""
    when = func.coalesce(SalesOrder.ordered_at, SalesOrder.received_at)
    day = func.date(func.timezone(tz, when))
    rows = db.execute(
        select(day, func.sum(SalesOrderItem.unit_price * SalesOrderItem.quantity))
        .join(SalesOrder, SalesOrderItem.order_id == SalesOrder.id)
        .where(
            SalesOrder.store_id == store_id,
            SalesOrder.status == "COMPLETED",
            SalesOrderItem.status == "COMPLETED",
            when >= start,
            when < end,
        )
        .group_by(day)
    ).all()
    return {d: t for d, t in rows}


def count_completed_orders_by_day(
    db: Session, store_id: UUID, start: datetime, end: datetime, tz: str
) -> dict[date, int]:
    """매출과 같은 완료 품목 기준. 여러 품목의 한 주문은 한 건으로 센다."""
    when = func.coalesce(SalesOrder.ordered_at, SalesOrder.received_at)
    day = func.date(func.timezone(tz, when))
    rows = db.execute(
        select(day, func.count(func.distinct(SalesOrder.id)))
        .join(SalesOrderItem, SalesOrderItem.order_id == SalesOrder.id)
        .where(
            SalesOrder.store_id == store_id,
            SalesOrder.status == "COMPLETED",
            SalesOrderItem.status == "COMPLETED",
            when >= start,
            when < end,
        )
        .group_by(day)
    ).all()
    return {d: int(count) for d, count in rows}


def menu_has_items(db: Session, store_id: UUID, menu_id: UUID) -> bool:
    return (
        db.scalars(
            select(SalesOrderItem.id).where(
                SalesOrderItem.store_id == store_id, SalesOrderItem.menu_item_id == menu_id
            )
        ).first()
        is not None
    )


def list_completed_sales_by_product(
    db: Session, store_id: UUID, start: datetime, end: datetime
) -> list[tuple[UUID | None, str, int, Decimal]]:
    """기간 완료 품목을 메뉴별로 묶은 (menu_item_id, 원 상품명, 수량, 금액). 미매핑은 상품명으로 묶는다."""
    when = func.coalesce(SalesOrder.ordered_at, SalesOrder.received_at)
    rows = db.execute(
        select(
            SalesOrderItem.menu_item_id,
            func.min(SalesOrderItem.raw_product_name),
            func.sum(SalesOrderItem.quantity),
            func.sum(SalesOrderItem.unit_price * SalesOrderItem.quantity),
        )
        .join(SalesOrder, SalesOrderItem.order_id == SalesOrder.id)
        .where(
            SalesOrder.store_id == store_id,
            SalesOrder.status == "COMPLETED",
            SalesOrderItem.status == "COMPLETED",
            when >= start,
            when < end,
        )
        .group_by(
            SalesOrderItem.menu_item_id,
            func.coalesce(
                cast(SalesOrderItem.menu_item_id, String), SalesOrderItem.raw_product_name
            ),
        )
    ).all()
    return [(m, name, int(q), t) for m, name, q, t in rows]
