from datetime import UTC, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.db.models import utcnow
from app.db.tenancy import RequestContext, bind_store_scope
from app.repositories import sales_orders as sales_order_repo
from app.repositories import visits as visit_repo
from app.schemas.today_summary import TodaySummary
from app.services.menus import get_store_or_404


def get_today_summary(db: Session, store_id: UUID) -> TodaySummary:
    bind_store_scope(db, RequestContext(store_id=store_id))
    store = get_store_or_404(db, store_id)
    tz = ZoneInfo(store.timezone)
    day = utcnow().astimezone(tz).date()
    start = datetime.combine(day, time.min, tz).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time.min, tz).astimezone(UTC)
    visits, guests = visit_repo.summary_between(db, store_id, start, end)
    return TodaySummary(
        today_visit_count=visits,
        today_guest_count=guests,
        today_net_sales_amount=sales_order_repo.sum_completed_sales_between(
            db, store_id, start, end
        ),
    )
