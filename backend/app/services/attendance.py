"""근태 계산. 원본 기록은 바꾸지 않고 마지막 정정을 투영한다."""

from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import utcnow
from app.db.models.attendance import (
    AttendanceCorrection,
    AttendanceEvent,
    AttendanceEventRetry,
    AttendancePreset,
    AttendanceShift,
    AuditLog,
    Staff,
)
from app.db.tenancy import RequestContext, bind_store_scope
from app.repositories import attendance as repo
from app.repositories import staff_auth as staff_auth_repo
from app.schemas.attendance import (
    AttendanceResponse,
    CorrectionResponse,
    CorrectionsCreate,
    EventCreate,
    EventResponse,
    Preset,
    PresetsUpdate,
    ShiftCreate,
    ShiftResponse,
    ShiftTime,
    StaffCreate,
    StaffResponse,
)
from app.services.menus import get_store_or_404

DEFAULT_PRESETS = [
    Preset(key="AM", label="오전 타임", start_minute=630, end_minute=900),
    Preset(key="PM", label="오후 타임", start_minute=900, end_minute=1290),
    Preset(key="OPEN", label="오픈 타임", start_minute=600, end_minute=840),
    Preset(key="CLOSE", label="마감 타임", start_minute=1020, end_minute=1320),
]


def _scope(db: Session, store_id: UUID):
    ctx = db.info.get("tenant_ctx")
    bind_store_scope(
        db, RequestContext(store_id=store_id, actor=ctx.actor) if ctx else RequestContext(store_id)
    )
    return get_store_or_404(db, store_id)


def _staff(db: Session, store_id: UUID, staff_id: UUID):
    row = repo.get_staff(db, store_id, staff_id)
    if row is None:
        raise AppError(404, "STAFF_NOT_FOUND", "직원을 찾을 수 없습니다.")
    return row


def create_staff(db: Session, store_id: UUID, payload: StaffCreate):
    _scope(db, store_id)
    row = Staff(store_id=store_id, **payload.model_dump())
    repo.add(db, row)
    _audit(db, store_id, "CREATE", "staff", row.id, None, _snapshot(row))
    db.commit()
    return row


def _snapshot(row: Staff | AttendanceShift | AttendanceEvent | AttendanceCorrection) -> dict:
    # 응답 스키마의 허용 필드만 저장한다. ORM 전체/요청 본문을 직렬화하지 않는다.
    schema = (
        StaffResponse
        if isinstance(row, Staff)
        else ShiftResponse
        if isinstance(row, AttendanceShift)
        else EventResponse
        if isinstance(row, AttendanceEvent)
        else CorrectionResponse
    )
    return schema.model_validate(row).model_dump(mode="json")


def _audit(db, store_id, action, entity, entity_id, before, after):
    ctx: RequestContext = db.info["tenant_ctx"]
    repo.add(
        db,
        AuditLog(
            store_id=store_id,
            actor=ctx.actor,
            action=action,
            entity=entity,
            entity_id=entity_id,
            before=before,
            after=after,
        ),
    )


def list_staff(db: Session, store_id: UUID, *, include_inactive: bool = False):
    _scope(db, store_id)
    return repo.list_staff(db, store_id, include_inactive=include_inactive)


def update_staff(db: Session, store_id: UUID, staff_id: UUID, payload: StaffCreate):
    _scope(db, store_id)
    row = _staff(db, store_id, staff_id)
    before = _snapshot(row)
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    _audit(db, store_id, "UPDATE", "staff", row.id, before, _snapshot(row))
    db.commit()
    return row


def deactivate_staff(db: Session, store_id: UUID, staff_id: UUID):
    _scope(db, store_id)
    row = _staff(db, store_id, staff_id)
    if row.status != "INACTIVE":
        before = _snapshot(row)
        row.status = "INACTIVE"
        staff_auth_repo.revoke_staff(db, store_id, staff_id, utcnow())
        _audit(db, store_id, "DEACTIVATE", "staff", row.id, before, _snapshot(row))
    db.commit()
    return {"deleted": True}


def save_shifts(db: Session, store_id: UUID, payload: ShiftCreate):
    _scope(db, store_id)
    if payload.staff_id:
        _staff(db, store_id, payload.staff_id)
    existing = repo.list_shifts(db, store_id, min(payload.dates), max(payload.dates))
    for row in existing:
        if (
            row.staff_id == payload.staff_id
            and row.work_date in payload.dates
            and row.start_minute < payload.end_minute
            and row.end_minute > payload.start_minute
        ):
            raise AppError(
                409, "SHIFT_OVERLAP", "같은 직원의 근무시간이 겹칩니다. 기존 시간을 수정해 주세요."
            )
    rows = []
    for day in payload.dates:
        row = AttendanceShift(
            store_id=store_id,
            staff_id=payload.staff_id,
            work_date=day,
            start_minute=payload.start_minute,
            end_minute=payload.end_minute,
            label=payload.label,
        )
        repo.add(db, row)
        _audit(db, store_id, "CREATE", "attendance_shifts", row.id, None, _snapshot(row))
        rows.append(row)
    db.commit()
    return [ShiftResponse.model_validate(row) for row in rows]


def update_shift(db: Session, store_id: UUID, shift_id: UUID, payload: ShiftTime):
    _scope(db, store_id)
    row = repo.get_shift(db, store_id, shift_id)
    if row is None:
        raise AppError(404, "SHIFT_NOT_FOUND", "스케줄을 찾을 수 없습니다.")
    if row.staff_id:
        _staff(db, store_id, row.staff_id)
    for other in repo.list_shifts(db, store_id, row.work_date, row.work_date):
        if (
            other.id != row.id
            and other.staff_id == row.staff_id
            and other.start_minute < payload.end_minute
            and other.end_minute > payload.start_minute
        ):
            raise AppError(409, "SHIFT_OVERLAP", "같은 직원의 근무시간이 겹칩니다.")
    before = _snapshot(row)
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    _audit(db, store_id, "UPDATE", "attendance_shifts", row.id, before, _snapshot(row))
    db.commit()
    return row


def delete_shift(db: Session, store_id: UUID, shift_id: UUID):
    _scope(db, store_id)
    row = repo.get_shift(db, store_id, shift_id)
    if row is None:
        raise AppError(404, "SHIFT_NOT_FOUND", "스케줄을 찾을 수 없습니다.")
    _audit(db, store_id, "DELETE", "attendance_shifts", row.id, _snapshot(row), None)
    repo.remove_shift(db, row)
    db.commit()
    return {"deleted": True}


def save_presets(db: Session, store_id: UUID, payload: PresetsUpdate):
    _scope(db, store_id)
    existing = {p.key: p for p in repo.list_presets(db, store_id)}
    for preset in payload.presets:
        row = existing.get(preset.key)
        if row:
            row.label, row.start_minute, row.end_minute = (
                preset.label,
                preset.start_minute,
                preset.end_minute,
            )
        else:
            repo.add(db, AttendancePreset(store_id=store_id, **preset.model_dump()))
    db.commit()
    return payload.presets


def _aware(value: datetime) -> datetime:
    # SQLite는 timezone 정보를 버린다. PostgreSQL에는 aware UTC로 저장한다.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def effective_events(events, corrections):
    rows = {
        e.id: {
            "id": e.id,
            "event_id": e.id,
            "staff_id": e.staff_id,
            "kind": e.kind,
            "at": _aware(e.occurred_at),
        }
        for e in events
    }
    roots = {}
    for correction in corrections:
        root = correction.event_id or roots.get(correction.previous_correction_id) or correction.id
        roots[correction.id] = root
        rows[root] = {
            "id": correction.id,
            "event_id": correction.event_id,
            "staff_id": correction.staff_id,
            "kind": correction.corrected_kind,
            "at": _aware(correction.corrected_at),
        }
    return sorted(rows.values(), key=lambda e: (e["at"], str(e["id"])))


def _validate_sequence(rows):
    last = {}
    for row in rows:
        previous = last.get(row["staff_id"])
        if (previous is None and row["kind"] != "IN") or (
            previous and (previous["kind"] == row["kind"] or row["at"] <= previous["at"])
        ):
            raise AppError(
                409,
                "ATTENDANCE_SEQUENCE",
                "출근 다음에 퇴근이 오도록 기록을 확인해 주세요. 퇴근은 출근보다 늦어야 합니다.",
            )
        last[row["staff_id"]] = row


def record_event(
    db: Session,
    store_id: UUID,
    payload: EventCreate,
    *,
    commit: bool = True,
    deduplicate_recent: bool = True,
):
    _scope(db, store_id)
    staff = _staff(db, store_id, payload.staff_id)  # PostgreSQL 직원 행 잠금으로 직렬화한다.
    existing = repo.get_event_by_client_id(db, store_id, staff.id, payload.client_event_id)
    if existing is not None:
        return existing, False
    if staff.status != "ACTIVE":
        raise AppError(409, "STAFF_INACTIVE", "비활성 직원의 출퇴근은 등록할 수 없습니다.")
    now = utcnow()
    existing = (
        repo.recent_event(db, store_id, staff.id, payload.kind, now - timedelta(seconds=60), now)
        if deduplicate_recent
        else None
    )
    if existing is not None:
        repo.add(
            db,
            AttendanceEventRetry(
                store_id=store_id,
                staff_id=staff.id,
                client_event_id=payload.client_event_id,
                event_id=existing.id,
            ),
        )
        if commit:
            db.commit()
        return existing, False
    row = AttendanceEvent(
        store_id=store_id,
        staff_id=payload.staff_id,
        kind=payload.kind,
        client_event_id=payload.client_event_id,
        occurred_at=now,
    )
    repo.add(db, row)
    try:
        _validate_sequence(
            effective_events(repo.list_events(db, store_id), repo.list_corrections(db, store_id))
        )
        if commit:
            db.commit()
    except AppError:
        db.rollback()
        raise
    return row, True


def correct_events(db: Session, store_id: UUID, payload: CorrectionsCreate):
    _scope(db, store_id)
    _staff(db, store_id, payload.staff_id)
    events = {e.id: e for e in repo.list_events(db, store_id)}
    corrections = repo.list_corrections(db, store_id)
    by_id = {c.id: c for c in corrections}
    effective = {e["id"]: e for e in effective_events(events.values(), corrections)}
    targets = set()
    rows = []
    try:
        for item in payload.items:
            if item.event_id and item.previous_correction_id:
                raise AppError(422, "CORRECTION_TARGET", "수정 대상은 하나만 지정해 주세요.")
            target = (
                events.get(item.event_id)
                if item.event_id
                else by_id.get(item.previous_correction_id)
                if item.previous_correction_id
                else None
            )
            if (item.event_id or item.previous_correction_id) and (
                target is None or target.staff_id != payload.staff_id
            ):
                raise AppError(404, "EVENT_NOT_FOUND", "해당 직원의 원본 기록을 찾을 수 없습니다.")
            if item.previous_correction_id and (
                item.previous_correction_id not in effective
                or by_id[item.previous_correction_id].event_id is not None
            ):
                raise AppError(409, "STALE_CORRECTION", "최신 기록을 다시 조회한 뒤 수정해 주세요.")
            key = item.event_id or item.previous_correction_id
            if key and key in targets:
                raise AppError(422, "DUPLICATE_CORRECTION", "수정 대상이 중복되었습니다.")
            targets.add(key)
            if item.corrected_at > utcnow():
                raise AppError(422, "FUTURE_ATTENDANCE", "미래 출퇴근 기록은 등록할 수 없습니다.")
            row = AttendanceCorrection(
                store_id=store_id,
                staff_id=payload.staff_id,
                reason=payload.reason,
                corrected_by_user_id=None,
                **{**item.model_dump(), "corrected_at": _aware(item.corrected_at)},
            )
            repo.add(db, row)
            rows.append(row)
        _validate_sequence(effective_events(events.values(), repo.list_corrections(db, store_id)))
        for row in rows:
            target = (
                events.get(row.event_id) if row.event_id else by_id.get(row.previous_correction_id)
            )
            _audit(
                db,
                store_id,
                "CORRECT",
                "attendance_corrections",
                row.id,
                _snapshot(target) if target else None,
                _snapshot(row),
            )
        db.commit()
    except AppError:
        db.rollback()
        raise
    return rows


def _opening(store):
    if not store.opening_hours:
        return None
    try:
        left, right = store.opening_hours.split("-")
        start = int(left.split(":")[0]) * 60 + int(left.split(":")[1])
        end = int(right.split(":")[0]) * 60 + int(right.split(":")[1])
        return start, end + (1440 if end <= start else 0)
    except (ValueError, IndexError):
        return None


def _minutes(start, end, lower, upper):
    return max(0, int((min(end, upper) - max(start, lower)).total_seconds() // 60))


def get_attendance(
    db: Session, store_id: UUID, start: date, end: date, *, include_inactive: bool = False
) -> AttendanceResponse:
    store = _scope(db, store_id)
    if end < start or (end - start).days > 41:
        raise AppError(422, "ATTENDANCE_RANGE", "조회 기간은 1~42일로 설정해 주세요.")
    zone = ZoneInfo(store.timezone)
    now = utcnow()
    lower = datetime.combine(start, time.min, zone).astimezone(UTC)
    upper = datetime.combine(end + timedelta(days=1), time.min, zone).astimezone(UTC)
    staff = repo.list_staff(db, store_id, include_inactive=include_inactive)
    shifts = repo.list_shifts(db, store_id, start - timedelta(days=1), end + timedelta(days=1))
    events, corrections = repo.list_events(db, store_id), repo.list_corrections(db, store_id)
    effective = effective_events(events, corrections)
    opening = _opening(store)
    sessions, pending = [], {}
    for event in effective:
        if event["kind"] == "IN":
            pending[event["staff_id"]] = event
        else:
            entry = pending.pop(event["staff_id"], None)
            if entry and entry["at"] < upper and event["at"] > lower:
                sessions.append(
                    dict(
                        staff_id=entry["staff_id"],
                        in_id=entry["id"],
                        out_id=event["id"],
                        in_event_id=entry["event_id"],
                        out_event_id=event["event_id"],
                        started_at=entry["at"],
                        ended_at=event["at"],
                        minutes=_minutes(entry["at"], event["at"], lower, upper),
                        missing=False,
                    )
                )
    for entry in pending.values():
        local_date = entry["at"].astimezone(zone).date()
        deadline = datetime.combine(local_date, time.min, zone) + timedelta(
            minutes=opening[1] if opening else 1440
        )
        missing = local_date < now.astimezone(zone).date() and now > deadline.astimezone(UTC)
        if entry["at"] < upper and (
            (not missing and now > lower) or (missing and start <= local_date <= end)
        ):
            sessions.append(
                dict(
                    staff_id=entry["staff_id"],
                    in_id=entry["id"],
                    out_id=None,
                    in_event_id=entry["event_id"],
                    out_event_id=None,
                    started_at=entry["at"],
                    ended_at=None,
                    minutes=None if missing else _minutes(entry["at"], now, lower, upper),
                    missing=missing,
                )
            )
    selected = [s for s in shifts if start <= s.work_date <= end]
    summary = []
    for person in staff:
        plans = [s for s in selected if s.staff_id == person.id]
        actual = [s for s in sessions if s["staff_id"] == person.id]
        planned = sum(s.end_minute - s.start_minute for s in plans)
        minutes = sum(s["minutes"] or 0 for s in actual)
        overtime = 0
        for offset in range((end - start).days + 1):
            day = start + timedelta(days=offset)
            day_start = datetime.combine(day, time.min, zone).astimezone(UTC)
            day_end = datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(UTC)
            worked = sum(
                _minutes(s["started_at"], s["ended_at"] or now, day_start, day_end)
                for s in actual
                if not s["missing"]
            )
            overtime += max(
                0, worked - sum(s.end_minute - s.start_minute for s in plans if s.work_date == day)
            )
        missing_count = sum(s["missing"] for s in actual)
        status = (
            "MISSING"
            if missing_count
            else "WORKING"
            if any(s["ended_at"] is None for s in actual)
            else "OUT"
            if actual
            else "EXPECTED"
            if plans
            else "NONE"
        )
        summary.append(
            dict(
                staff_id=person.id,
                planned_minutes=planned,
                actual_minutes=minutes,
                overtime_minutes=overtime,
                missing_count=missing_count,
                last_kind=next(
                    (e["kind"] for e in reversed(effective) if e["staff_id"] == person.id), None
                ),
                status=status,
            )
        )
    gaps = []
    days = (store.business_days or "").split(",")
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        if (
            not opening
            or not store.business_days
            or ("연중무휴" not in days and "월화수목금토일"[day.weekday()] not in days)
        ):
            continue
        midnight = datetime.combine(day, time.min, zone)
        begin, finish = (
            midnight + timedelta(minutes=opening[0]),
            midnight + timedelta(minutes=opening[1]),
        )
        coverage = sorted(
            (
                datetime.combine(s.work_date, time.min, zone) + timedelta(minutes=s.start_minute),
                datetime.combine(s.work_date, time.min, zone) + timedelta(minutes=s.end_minute),
            )
            for s in shifts
        )
        cursor = begin
        for left, right in coverage:
            if right <= cursor or left >= finish:
                continue
            if left > cursor:
                gaps.append(dict(work_date=day, started_at=cursor, ended_at=min(left, finish)))
            cursor = max(cursor, min(right, finish))
        if cursor < finish:
            gaps.append(dict(work_date=day, started_at=cursor, ended_at=finish))
    preset_rows = {p.key: p for p in repo.list_presets(db, store_id)}
    presets = [
        Preset(key=default.key, label=p.label, start_minute=p.start_minute, end_minute=p.end_minute)
        if (p := preset_rows.get(default.key))
        else default
        for default in DEFAULT_PRESETS
    ]
    return AttendanceResponse.model_validate(
        dict(
            start=start,
            end=end,
            now=now,
            staff=staff,
            shifts=selected,
            presets=presets,
            events=events,
            corrections=corrections,
            sessions=sessions,
            summary=summary,
            gaps=gaps,
        )
    )
