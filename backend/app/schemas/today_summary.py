from decimal import Decimal

from pydantic import BaseModel


class TodaySummary(BaseModel):
    today_visit_count: int
    today_guest_count: int
    today_net_sales_amount: Decimal
