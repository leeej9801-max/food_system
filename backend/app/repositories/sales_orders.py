from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import SalesOrder


def list_completed_with_items(db: Session, store_id: str) -> list[SalesOrder]:
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
