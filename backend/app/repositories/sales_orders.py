from collections.abc import Collection
from uuid import UUID

from sqlalchemy import select
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


def list_with_items(db: Session, store_id: UUID) -> list[SalesOrder]:
    return list(
        db.scalars(
            select(SalesOrder)
            .options(selectinload(SalesOrder.items))
            .where(SalesOrder.store_id == store_id)
            .execution_options(populate_existing=True)
        ).all()
    )


def list_recent_with_items(db: Session, store_id: UUID) -> list[SalesOrder]:
    """받은 시각·외부 주문번호 내림차순."""
    return list(
        db.scalars(
            select(SalesOrder)
            .options(selectinload(SalesOrder.items))
            .where(SalesOrder.store_id == store_id)
            .order_by(SalesOrder.received_at.desc(), SalesOrder.external_order_id.desc())
        ).all()
    )


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
