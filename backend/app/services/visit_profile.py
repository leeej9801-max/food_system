"""방문 객층·맥락 입력과 영업 종료 자동 닫기 (WO-20261105-001, U-31).

손님(GUEST)이 넣은 값이 직원(STAFF) 값보다 우선한다. 직원은 손님이 비워 둔 곳만 채운다.
자동 닫기는 별도 스케줄러 없이, 홀·방문·손님 API가 호출될 때 먼저 정리한다(지연 닫기).
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import SessionSlot, Store, VisitSession, utcnow

OPEN_STATUSES = ("SEATED", "PAID")


def recompute_age_band(visit: VisitSession) -> None:
    """사람별 연령대로 세션 대표 연령대를 다시 계산한다 (기존 분석 호환)."""
    bands = {s.age_band for s in visit.slots if s.age_band != "UNRECORDED"}
    if not bands:
        return  # 직원이 세션 단위로만 넣은 기존 값은 유지
    visit.age_band = bands.pop() if len(bands) == 1 else "MIXED"


def apply_slot_profile(
    visit: VisitSession,
    slot: SessionSlot,
    *,
    source: str,
    gender: str | None,
    age_band: str | None,
) -> None:
    if gender is None and age_band is None:
        return
    if source == "STAFF" and slot.profile_source == "GUEST":
        raise AppError(
            status_code=409,
            code="SLOT_PROFILE_BY_GUEST",
            message="손님이 직접 입력한 자리라 직원이 바꿀 수 없습니다.",
        )
    if gender is not None:
        slot.gender = gender
    if age_band is not None:
        slot.age_band = age_band
    slot.profile_source = source
    recompute_age_band(visit)


def apply_visit_context(
    visit: VisitSession,
    *,
    source: str,
    purpose: str | None,
    relationship: str | None,
) -> None:
    if purpose is None and relationship is None:
        return
    if source == "STAFF" and visit.context_source == "GUEST":
        raise AppError(
            status_code=409,
            code="CONTEXT_BY_GUEST",
            message="손님이 직접 입력한 방문 목적·관계라 직원이 바꿀 수 없습니다.",
        )
    if purpose is not None:
        visit.purpose = purpose
    if relationship is not None:
        visit.relationship_type = relationship
    visit.context_source = source


# --- 영업 종료 자동 닫기 (END_OF_DAY) ---


def _parse_hours(opening_hours: str | None) -> tuple[time, time] | None:
    """'11:00-21:00' → (11:00, 21:00). 읽을 수 없으면 None (닫지 않는다)."""
    if not opening_hours or "-" not in opening_hours:
        return None
    try:
        start_s, end_s = (part.strip() for part in opening_hours.split("-", 1))
        start = time.fromisoformat(start_s)
        end = time.fromisoformat(end_s)
    except ValueError:
        return None
    return start, end


def business_close_at(store: Store, seated_at: datetime) -> tuple[datetime, datetime] | None:
    """착석 시각이 속한 영업일의 (퇴점으로 기록할 시각, 닫기를 실행할 시각), UTC.

    퇴점 시각은 영업 종료 시각(종료 후 착석이면 착석 시각)이다. 닫기는 다음 영업 시작 시각에
    실행한다. 종료 시각 직후 닫으면 아직 앉아 있는 손님의 세션까지 닫히기 때문이다.
    자정을 넘는 영업("11:00-02:00")은 다음 날 종료로 본다.
    """
    hours = _parse_hours(store.opening_hours)
    if hours is None:
        return None
    start, end = hours
    tz = ZoneInfo(store.timezone or "Asia/Seoul")
    local = seated_at.astimezone(tz)
    overnight = end <= start
    business_day: date = local.date()
    if overnight and local.time() < end:
        business_day -= timedelta(days=1)  # 새벽 착석은 전날 영업
    close_day = business_day + timedelta(days=1) if overnight else business_day
    left_local = max(datetime.combine(close_day, end, tzinfo=tz), local)
    run_local = datetime.combine(business_day + timedelta(days=1), start, tzinfo=tz)
    utc = ZoneInfo("UTC")
    return left_local.astimezone(utc), run_local.astimezone(utc)


def close_expired_sessions(db: Session, store_id: str, now: datetime | None = None) -> int:
    """지난 영업일의 열린 세션을 LEFT·END_OF_DAY로 닫는다. 닫은 수를 돌려준다."""
    store = db.get(Store, store_id)
    if store is None:
        return 0
    now = now or utcnow()
    open_visits = db.scalars(
        select(VisitSession).where(
            VisitSession.store_id == store_id, VisitSession.status.in_(OPEN_STATUSES)
        )
    ).all()
    closed = 0
    for visit in open_visits:
        seated = visit.seated_at
        if seated.tzinfo is None:  # SQLite는 tz 정보를 잃는다. 저장값은 UTC다.
            seated = seated.replace(tzinfo=ZoneInfo("UTC"))
        times = business_close_at(store, seated)
        if times is None or now < times[1]:
            continue
        visit.status = "LEFT"
        visit.left_at = times[0]
        visit.closed_reason = "END_OF_DAY"
        closed += 1
    if closed:
        db.flush()
    return closed
