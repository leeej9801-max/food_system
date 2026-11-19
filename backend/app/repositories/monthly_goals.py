from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db.models import MonthlyGoal, utcnow


def get(db: Session, store_id: UUID, month: str) -> MonthlyGoal | None:
    return db.scalar(
        select(MonthlyGoal).where(MonthlyGoal.store_id == store_id, MonthlyGoal.month == month)
    )


def get_latest_before(db: Session, store_id: UUID, month: str) -> MonthlyGoal | None:
    return db.scalar(
        select(MonthlyGoal)
        .where(MonthlyGoal.store_id == store_id, MonthlyGoal.month < month)
        .order_by(MonthlyGoal.month.desc())
        .limit(1)
    )


def upsert(
    db: Session,
    store_id: UUID,
    month: str,
    *,
    revenue_target: int | None,
    profit_target: int | None,
) -> MonthlyGoal:
    statement = insert(MonthlyGoal).values(
        store_id=store_id,
        month=month,
        revenue_target=revenue_target,
        profit_target=profit_target,
    )
    return db.scalars(
        statement.on_conflict_do_update(
            constraint="monthly_goals_store_month_key",
            set_={
                "revenue_target": statement.excluded.revenue_target,
                "profit_target": statement.excluded.profit_target,
                "updated_at": utcnow(),
            },
        ).returning(MonthlyGoal),
        execution_options={"populate_existing": True},
    ).one()
