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
