from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models import MonthlyExpense


def list_by_month(db: Session, store_id: UUID, month: str) -> list[MonthlyExpense]:
    return list(
        db.scalars(
            select(MonthlyExpense)
            .where(MonthlyExpense.store_id == store_id, MonthlyExpense.month == month)
            .order_by(MonthlyExpense.created_at.asc())
        ).all()
    )


def replace_month(db: Session, store_id: UUID, month: str, rows: list[MonthlyExpense]) -> None:
    db.execute(
        delete(MonthlyExpense).where(
            MonthlyExpense.store_id == store_id, MonthlyExpense.month == month
        )
    )
    db.add_all(rows)
