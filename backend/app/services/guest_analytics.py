"""손님 객층·날씨 분석 (WO-20261116-002, U-55).

- 객층: 사람별 성별·연령대(session_slots), 방문 단위 동반 관계·방문 목적·인원(visit_sessions).
- 주문–방문 연결: 주문과 방문을 잇는 키가 없어 주문 시각이 착석–퇴점 사이에 든 방문이
  정확히 하나일 때만 짝짓는다. 둘 이상이면 모호, 없으면 미연결로 센다 (PROVISIONAL).
- 날씨: 기상청 AWS 일값(weather_daily, U-56)와 영업일 매출·손님 수를 날짜로 잇는다.
"""

from collections import Counter, defaultdict
from collections.abc import Callable
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import SalesOrder, VisitSession
from app.repositories import menus as menu_repo
from app.repositories import sales_orders as sales_order_repo
from app.repositories import visits as visit_repo
from app.repositories import weather as weather_repo
from app.schemas import (
    CountBucket,
    GuestAnalyticsResponse,
    GuestMenuBucket,
    MenuQuantity,
    WeatherDayItem,
    WeatherGroupItem,
)
from app.services.menus import get_store_or_404
from app.services.visit_profile import close_expired_sessions

TOP_N = 3
# PROVISIONAL: 비 오는 날은 일 강수량 1mm 이상, 기온 구간은 일 평균기온 기준 (사장님 확인 전)
RAIN_MM = Decimal("1")
TEMP_BANDS = ((Decimal("5"), "COLD"), (Decimal("15"), "COOL"), (Decimal("25"), "MILD"))
GROUP_ORDER = ("RAIN", "DRY", "COLD", "COOL", "MILD", "HOT")


def _utc(dt: datetime) -> datetime:
    # SQLite는 tz 정보를 잃는다. 저장값은 UTC다
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def _buckets(counter: Counter[str]) -> list[CountBucket]:
    return [CountBucket(key=k, count=v) for k, v in counter.most_common()]


def _top(counter: Counter[str]) -> list[MenuQuantity]:
    return [MenuQuantity(menu_name=k, quantity=v) for k, v in counter.most_common(TOP_N)]


def _order_menus(order: SalesOrder, names: dict[UUID, str]) -> Counter[str]:
    result: Counter[str] = Counter()
    for item in order.items:
        if item.status != "COMPLETED":
            continue
        name = item.raw_product_name
        if item.menu_item_id:
            name = names.get(item.menu_item_id, name)
        result[name] += item.quantity
    return result


def _order_sales(order: SalesOrder) -> Decimal:
    return sum(
        (Decimal(str(i.unit_price)) * i.quantity for i in order.items if i.status == "COMPLETED"),
        Decimal("0"),
    )


def match_orders(
    orders: list[SalesOrder], visits: list[VisitSession], now: datetime
) -> tuple[dict[UUID, list[SalesOrder]], int, int]:
    """시각이 있는 주문을 착석–퇴점 구간이 겹치는 유일한 방문에 붙인다. (연결, 모호 수, 미연결 수)."""
    spans = [(v.id, _utc(v.seated_at), _utc(v.left_at) if v.left_at else now) for v in visits]
    matched: dict[UUID, list[SalesOrder]] = defaultdict(list)
    ambiguous = unmatched = 0
    for order in orders:
        if order.time_basis != "order_time" or order.ordered_at is None:
            unmatched += 1
            continue
        at = _utc(order.ordered_at)
        hits = [vid for vid, start, end in spans if start <= at <= end]
        if len(hits) == 1:
            matched[hits[0]].append(order)
        elif hits:
            ambiguous += 1
        else:
            unmatched += 1
    return matched, ambiguous, unmatched


def temp_band(avg: Decimal) -> str:
    return next((name for limit, name in TEMP_BANDS if avg < limit), "HOT")


def get_guest_analytics(db: Session, *, store_id: UUID) -> GuestAnalyticsResponse:
    get_store_or_404(db, store_id)
    if close_expired_sessions(db, store_id):
        db.commit()
    tz = ZoneInfo(settings.app_timezone)
    names = {m.id: m.name for m in menu_repo.list_by_store(db, store_id)}
    visits = visit_repo.list_with_table_and_slots(db, store_id)
    orders = sales_order_repo.list_completed_with_items(db, store_id)

    ages: Counter[str] = Counter()
    genders: Counter[str] = Counter()
    profiled = 0
    for v in visits:
        for s in v.slots:
            if s.age_band != "UNRECORDED":
                ages[s.age_band] += 1
            if s.gender != "UNRECORDED":
                genders[s.gender] += 1
            if s.age_band != "UNRECORDED" or s.gender != "UNRECORDED":
                profiled += 1
    relationships = Counter(v.relationship_type for v in visits if v.relationship_type)
    purposes = Counter(v.purpose for v in visits if v.purpose)
    party_sizes = Counter(str(v.party_size) for v in visits)
    stays = [(_utc(v.left_at) - _utc(v.seated_at)).total_seconds() for v in visits if v.left_at]

    matched, ambiguous, unmatched = match_orders(orders, visits, datetime.now(UTC))
    by_visit = {v.id: v for v in visits}

    def menu_groups(key_of: Callable[[VisitSession], str | None]) -> list[GuestMenuBucket]:
        menus: dict[str, Counter[str]] = defaultdict(Counter)
        counts: Counter[str] = Counter()
        for vid, vorders in matched.items():
            key = key_of(by_visit[vid])
            if not key:
                continue
            counts[key] += 1
            for o in vorders:
                menus[key] += _order_menus(o, names)
        return [
            GuestMenuBucket(key=k, visit_count=c, top_menus=_top(menus[k]))
            for k, c in counts.most_common()
        ]

    # 현지 날짜별 매출·판매 메뉴·손님 수·동반 관계
    day_sales: dict[date, Decimal] = defaultdict(Decimal)
    day_menus: dict[date, Counter[str]] = defaultdict(Counter)
    day_guests: Counter[date] = Counter()
    day_rel: dict[date, Counter[str]] = defaultdict(Counter)
    for o in orders:
        if o.ordered_at is not None:
            d = _utc(o.ordered_at).astimezone(tz).date()
            day_sales[d] += _order_sales(o)
            day_menus[d] += _order_menus(o, names)
    for v in visits:
        d = _utc(v.seated_at).astimezone(tz).date()
        day_guests[d] += v.party_size
        if v.relationship_type:
            day_rel[d][v.relationship_type] += 1

    station = settings.kma_station_id
    weather_days: list[WeatherDayItem] = []
    groups: dict[str, list[date]] = defaultdict(list)
    open_days = sorted(set(day_sales) | set(day_guests))
    if station and open_days:
        for w in weather_repo.list_between(db, station, open_days[0], open_days[-1]):
            d = w.weather_date
            if d not in day_sales and d not in day_guests:
                continue  # 휴무일은 빼고 영업한 날끼리 비교한다
            weather_days.append(
                WeatherDayItem(
                    day=d,
                    avg_temp=w.avg_temp,
                    precipitation_mm=w.precipitation_mm,
                    net_sales=day_sales[d].quantize(Decimal("0.01")),
                    guest_count=day_guests[d],
                )
            )
            if w.precipitation_mm is not None:
                groups["RAIN" if w.precipitation_mm >= RAIN_MM else "DRY"].append(d)
            if w.avg_temp is not None:
                groups[temp_band(w.avg_temp)].append(d)

    weather_groups = []
    for key in GROUP_ORDER:
        ds = groups.get(key)
        if not ds:
            continue
        menus: Counter[str] = Counter()
        rels: Counter[str] = Counter()
        for d in ds:
            menus += day_menus[d]
            rels += day_rel[d]
        n = Decimal(len(ds))
        total_sales = sum((day_sales[d] for d in ds), Decimal("0"))
        weather_groups.append(
            WeatherGroupItem(
                key=key,
                day_count=len(ds),
                avg_net_sales=(total_sales / n).quantize(Decimal("0.01")),
                avg_guest_count=(Decimal(sum(day_guests[d] for d in ds)) / n).quantize(
                    Decimal("0.1")
                ),
                top_menus=_top(menus),
                top_relationships=_buckets(rels)[:TOP_N],
            )
        )

    return GuestAnalyticsResponse(
        store_id=store_id,
        visit_count=len(visits),
        guest_count=sum(v.party_size for v in visits),
        profiled_person_count=profiled,
        avg_stay_minutes=round(sum(stays) / len(stays) / 60) if stays else None,
        age_bands=_buckets(ages),
        genders=_buckets(genders),
        relationships=_buckets(relationships),
        purposes=_buckets(purposes),
        party_sizes=sorted(_buckets(party_sizes), key=lambda b: int(b.key)),
        matched_order_count=sum(len(o) for o in matched.values()),
        ambiguous_order_count=ambiguous,
        unmatched_order_count=unmatched,
        menu_by_relationship=menu_groups(lambda v: v.relationship_type),
        menu_by_age_band=menu_groups(lambda v: None if v.age_band == "UNRECORDED" else v.age_band),
        weather_station_configured=bool(station),
        weather_days=weather_days,
        weather_groups=weather_groups,
    )
