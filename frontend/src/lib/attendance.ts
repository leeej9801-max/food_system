import type { Shift, WorkSession } from "../api/attendance";

export type AttendanceView = "day" | "week" | "month";
export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
export const OWNER = "owner";
export const ATTENDANCE_GRACE_MINUTES = 5;

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseDay(value: string): Date { return new Date(`${value}T12:00:00`); }
export function addDays(value: string, days: number): string {
  const date = parseDay(value);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}
export function storeDay(value: string | Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function periodFor(day: string, view: AttendanceView): { start: string; end: string } {
  const date = parseDay(day);
  if (view === "day") return { start: day, end: day };
  if (view === "week") {
    const start = addDays(day, -((date.getDay() + 6) % 7));
    return { start, end: addDays(start, 6) };
  }
  return { start: dateKey(new Date(date.getFullYear(), date.getMonth(), 1)), end: dateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)) };
}
export function navigatePeriod(day: string, view: AttendanceView, delta: number): string {
  if (view !== "month") return addDays(day, delta * (view === "week" ? 7 : 1));
  const date = parseDay(day);
  const last = new Date(date.getFullYear(), date.getMonth() + delta + 1, 0).getDate();
  return dateKey(new Date(date.getFullYear(), date.getMonth() + delta, Math.min(date.getDate(), last)));
}
export function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}
export function monthGrid(day: string): string[] {
  const period = periodFor(day, "month");
  const start = periodFor(period.start, "week").start;
  const end = periodFor(period.end, "week").end;
  return daysBetween(start, end);
}
export function isClosed(day: string, businessDays: string | null): boolean {
  if (!businessDays || businessDays === "연중무휴") return false;
  return !businessDays.split(",").includes(WEEKDAYS[(parseDay(day).getDay() + 6) % 7]);
}
export function clock(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
export function timeRange(start: string, end: string): string { return `${start} ~ ${end}`; }
export function shortDateRange(start: string, end: string): string {
  const fmt = (d: string) => d.slice(5).replace("-", ".");
  return start === end ? fmt(start) : `${fmt(start)} ~ ${fmt(end)}`;
}
export function overtimeMinutes(actualMinutes: number, plannedMinutes: number): number { return Math.max(0, actualMinutes - plannedMinutes); }
export function hours(minutes: number): string { return `${Number((minutes / 60).toFixed(1))}h`; }
export function localTime(value: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
export function dateLabel(day: string): string {
  const date = parseDay(day);
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. (${"일월화수목금토"[date.getDay()]})`;
}
export function periodLabel(day: string, view: AttendanceView): string {
  if (view === "day") return dateLabel(day);
  const date = parseDay(day);
  if (view === "month") return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
  const { start, end } = periodFor(day, view);
  const left = parseDay(start), right = parseDay(end);
  return `${left.getFullYear()}. ${left.getMonth() + 1}. ${left.getDate()}. ~ ${right.getFullYear() !== left.getFullYear() ? `${right.getFullYear()}. ` : ""}${right.getMonth() + 1}. ${right.getDate()}.`;
}
export function resizedTime(start: number, end: number, edge: "start" | "end", delta: number) {
  const step = Math.round(delta / 30) * 30;
  return edge === "start" ? { start_minute: Math.max(0, Math.min(end - 60, start + step)), end_minute: end } : { start_minute: start, end_minute: Math.min(1440, Math.max(start + 60, end + step)) };
}

// datetime-local은 브라우저 시간대가 아니라 매장 시간대로 해석한다.
export function zonedInputToIso(input: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input);
  if (!match) throw new Error("일자와 시간을 입력해 주세요.");
  const [, y, m, d, h, minute] = match;
  const target = Date.UTC(+y, +m - 1, +d, +h, +minute);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const parts = formatter.formatToParts(new Date(instant));
    const get = (key: string) => Number(parts.find((p) => p.type === key)?.value);
    const rendered = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    instant += target - rendered;
  }
  if (`${storeDay(new Date(instant), timezone)}T${localTime(new Date(instant), timezone)}` !== input) throw new Error("매장 시간대에 존재하지 않는 시간입니다.");
  return new Date(instant).toISOString();
}

export function minuteOfStoreDay(value: string | Date, day: string, timezone: string): number {
  const targetDay = storeDay(value, timezone);
  if (targetDay < day) return 0;
  if (targetDay > day) return 1440;
  const [h, m] = localTime(value, timezone).split(":").map(Number);
  return Math.min(1440, Math.max(0, h * 60 + m));
}

export type TimelineSegmentKind = "normal" | "overtime" | "unplanned" | "missing";

export interface TimelineBarSegment {
  kind: TimelineSegmentKind;
  startMinute: number;
  endMinute: number;
}

export interface TimelineGap {
  kind: "late" | "earlyLeave";
  startMinute: number;
  endMinute: number;
  minutes: number;
}

export interface ShiftInterval {
  id: string;
  start_minute: number;
  end_minute: number;
}

export interface SessionInterval {
  id: string;
  staff_id: string;
  startMinute: number;
  endMinute: number;
  actualStartLabel: string;
  actualEndLabel: string;
  isLive: boolean;
  isMissing: boolean;
}

export interface AnalyzedSessionBar {
  sessionId: string;
  staffId: string;
  startMinute: number;
  endMinute: number;
  actualStartLabel: string;
  actualEndLabel: string;
  isLive: boolean;
  isMissing: boolean;
  isUnplanned: boolean;
  segments: TimelineBarSegment[];
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  matchedShiftIds: string[];
}

export interface DayTimelineAnalysis {
  bars: AnalyzedSessionBar[];
  gaps: TimelineGap[];
  totalLateMinutes: number;
  totalEarlyLeaveMinutes: number;
  totalOvertimeMinutes: number;
  hasUnplanned: boolean;
}

export function sessionsForDay(
  sessions: WorkSession[],
  shifts: ShiftInterval[],
  day: string,
  timezone: string,
  nowIso: string,
): SessionInterval[] {
  const sortedShifts = [...shifts].sort((a, b) => a.start_minute - b.start_minute);
  return sessions
    .filter((s) => {
      const startDay = storeDay(s.started_at, timezone);
      if (s.missing) return startDay === day;
      const endDay = storeDay(s.ended_at ?? nowIso, timezone);
      return startDay <= day && endDay >= day;
    })
    .map((s) => {
      const startMinute = minuteOfStoreDay(s.started_at, day, timezone);
      const isLive = !s.ended_at && !s.missing;
      const endAt = s.ended_at ?? nowIso;
      const matchingShift = sortedShifts.find((sh) => sh.end_minute > startMinute) ?? sortedShifts.at(-1);
      const endMinute = s.missing
        ? Math.min(1440, Math.max(startMinute + 30, matchingShift?.end_minute ?? startMinute + 60))
        : minuteOfStoreDay(endAt, day, timezone);
      const startLabel = localTime(s.started_at, timezone);
      const endLabel = s.ended_at
        ? localTime(s.ended_at, timezone)
        : s.missing
          ? "퇴근 누락"
          : "근무 중";
      return {
        id: s.in_id,
        staff_id: s.staff_id,
        startMinute,
        endMinute: Math.max(startMinute, endMinute),
        actualStartLabel: startLabel,
        actualEndLabel: endLabel,
        isLive,
        isMissing: s.missing,
      };
    });
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  if (aStart === aEnd) return aStart >= bStart && aStart <= bEnd;
  return aEnd > bStart && aStart < bEnd;
}

function pushSegment(segments: TimelineBarSegment[], kind: TimelineSegmentKind, startMinute: number, endMinute: number) {
  if (endMinute < startMinute) return;
  if (segments.length > 0 && segments[segments.length - 1].kind === kind && segments[segments.length - 1].endMinute === startMinute) {
    segments[segments.length - 1].endMinute = endMinute;
    return;
  }
  segments.push({ kind, startMinute, endMinute });
}

export interface TimelineAxis {
  startMinute: number;
  endMinute: number;
  openMinute: number;
  closeMinute: number;
  hasOpeningHours: boolean;
  closePastMidnight: boolean;
  ticks: { minute: number; label: string; pct: number }[];
  ampmMarkers: { label: "AM" | "PM"; pct: number }[];
}

export function timelineAxis(openingHours: string | null | undefined, padMinutes: number = 60): TimelineAxis {
  let openMinute = 0;
  let closeMinute = 1440;
  let hasOpeningHours = false;
  let closePastMidnight = false;

  if (openingHours) {
    const match = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(openingHours);
    if (match) {
      const h1 = Number(match[1]);
      const m1 = Number(match[2]);
      const h2 = Number(match[3]);
      const m2 = Number(match[4]);
      if (h1 >= 0 && h1 <= 24 && m1 >= 0 && m1 < 60 && h2 >= 0 && h2 <= 24 && m2 >= 0 && m2 < 60) {
        const start = h1 * 60 + m1;
        const end = h2 * 60 + m2;
        if (start < 1440 && end <= 1440 && start !== end) {
          hasOpeningHours = true;
          openMinute = start;
          if (end <= start) {
            closePastMidnight = true;
            closeMinute = 1440;
          } else {
            closeMinute = end;
          }
        }
      }
    }
  }

  let startMinute = 0;
  let endMinute = 1440;
  if (hasOpeningHours && !closePastMidnight) {
    startMinute = Math.max(0, Math.floor((openMinute - padMinutes) / 60) * 60);
    endMinute = Math.min(1440, Math.ceil((closeMinute + padMinutes) / 60) * 60);
    if (endMinute - startMinute < 180) {
      startMinute = 0;
      endMinute = 1440;
    }
  }

  const span = Math.max(60, endMinute - startMinute);
  const spanHours = Math.round(span / 60);
  const stepHours = spanHours <= 14 ? 1 : spanHours <= 18 ? 2 : 3;
  const ticks: { minute: number; label: string; pct: number }[] = [];
  for (let m = startMinute; m <= endMinute; m += stepHours * 60) {
    const h = Math.floor(m / 60) % 24;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const label = stepHours === 1 ? `${String(Math.floor(m / 60) === 24 ? 24 : h).padStart(2, "0")}` : `${h12}`;
    ticks.push({ minute: m, label, pct: ((m - startMinute) / span) * 100 });
  }
  if (ticks.length === 0 || ticks[ticks.length - 1].minute < endMinute) {
    const h = Math.floor(endMinute / 60) % 24;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const label = stepHours === 1 ? `${String(Math.floor(endMinute / 60) === 24 ? 24 : h).padStart(2, "0")}` : `${h12}`;
    ticks.push({ minute: endMinute, label, pct: 100 });
  }

  const ampmMarkers: { label: "AM" | "PM"; pct: number }[] = [];
  if (startMinute < 720) {
    ampmMarkers.push({ label: "AM", pct: 0 });
  }
  if (endMinute > 720) {
    const pmMinute = Math.max(startMinute, 720);
    ampmMarkers.push({ label: "PM", pct: ((pmMinute - startMinute) / span) * 100 });
  }

  return {
    startMinute,
    endMinute,
    openMinute,
    closeMinute,
    hasOpeningHours,
    closePastMidnight,
    ticks,
    ampmMarkers,
  };
}

export function timelineSpanStyle(leftMinute: number, rightMinute: number, axis: Pick<TimelineAxis, "startMinute" | "endMinute">) {
  const span = Math.max(1, axis.endMinute - axis.startMinute);
  const clampedLeft = Math.max(axis.startMinute, Math.min(axis.endMinute, leftMinute));
  const clampedRight = Math.max(clampedLeft, Math.min(axis.endMinute, rightMinute));
  return {
    left: `${((clampedLeft - axis.startMinute) / span) * 100}%`,
    width: `${((clampedRight - clampedLeft) / span) * 100}%`,
  };
}

export function timelinePointPct(minute: number, axis: Pick<TimelineAxis, "startMinute" | "endMinute">): number {
  const span = Math.max(1, axis.endMinute - axis.startMinute);
  const clamped = Math.max(axis.startMinute, Math.min(axis.endMinute, minute));
  return ((clamped - axis.startMinute) / span) * 100;
}

export function analyzeDayTimeline(
  shifts: ShiftInterval[],
  sessions: SessionInterval[],
  graceMinutes: number = ATTENDANCE_GRACE_MINUTES,
  currentMinute?: number,
): DayTimelineAnalysis {
  const sortedShifts = [...shifts].sort((a, b) => a.start_minute - b.start_minute || a.end_minute - b.end_minute);
  const sortedSessions = [...sessions].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);

  const gaps: TimelineGap[] = [];
  const shiftStats = new Map<string, { lateMinutes: number; earlyLeaveMinutes: number }>();

  for (const shift of sortedShifts) {
    const overlapping = sortedSessions.filter((s) => intervalsOverlap(s.startMinute, s.endMinute, shift.start_minute, shift.end_minute));
    if (!overlapping.length) {
      if (currentMinute !== undefined && currentMinute > shift.start_minute + graceMinutes) {
        const endMinute = Math.min(currentMinute, shift.end_minute);
        const lateMinutes = endMinute - shift.start_minute;
        if (lateMinutes > graceMinutes) {
          gaps.push({ kind: "late", startMinute: shift.start_minute, endMinute, minutes: lateMinutes });
          shiftStats.set(shift.id, { lateMinutes, earlyLeaveMinutes: 0 });
        }
      }
      continue;
    }

    const firstStart = Math.min(...overlapping.map((s) => s.startMinute));
    const lateDiff = firstStart - shift.start_minute;
    const lateMinutes = lateDiff > graceMinutes ? lateDiff : 0;
    if (lateMinutes > 0) {
      gaps.push({ kind: "late", startMinute: shift.start_minute, endMinute: firstStart, minutes: lateMinutes });
    }

    let earlyLeaveMinutes = 0;
    const hasOpenSession = overlapping.some((s) => s.isLive || s.isMissing);
    if (!hasOpenSession) {
      const lastEnd = Math.max(...overlapping.map((s) => s.endMinute));
      const earlyDiff = shift.end_minute - lastEnd;
      if (earlyDiff > graceMinutes) {
        earlyLeaveMinutes = earlyDiff;
        gaps.push({ kind: "earlyLeave", startMinute: lastEnd, endMinute: shift.end_minute, minutes: earlyLeaveMinutes });
      }
    }

    shiftStats.set(shift.id, { lateMinutes, earlyLeaveMinutes });
  }

  const bars: AnalyzedSessionBar[] = sortedSessions.map((session) => {
    const matchedShifts = sortedShifts.filter((sh) => intervalsOverlap(session.startMinute, session.endMinute, sh.start_minute, sh.end_minute));
    if (!matchedShifts.length) {
      const kind: TimelineSegmentKind = session.isMissing ? "missing" : "unplanned";
      return {
        sessionId: session.id,
        staffId: session.staff_id,
        startMinute: session.startMinute,
        endMinute: session.endMinute,
        actualStartLabel: session.actualStartLabel,
        actualEndLabel: session.actualEndLabel,
        isLive: session.isLive,
        isMissing: session.isMissing,
        isUnplanned: true,
        segments: [{ kind, startMinute: session.startMinute, endMinute: session.endMinute }],
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        overtimeMinutes: session.isMissing ? 0 : Math.max(0, session.endMinute - session.startMinute),
        matchedShiftIds: [],
      };
    }

    const segments: TimelineBarSegment[] = [];
    if (session.isMissing) {
      pushSegment(segments, "missing", session.startMinute, session.endMinute);
    } else if (session.startMinute === session.endMinute) {
      pushSegment(segments, "normal", session.startMinute, session.endMinute);
    } else {
      let cursor = session.startMinute;
      const firstShift = matchedShifts[0];
      if (cursor < firstShift.start_minute) {
        const earlyDiff = firstShift.start_minute - cursor;
        pushSegment(segments, earlyDiff > graceMinutes ? "overtime" : "normal", cursor, firstShift.start_minute);
        cursor = firstShift.start_minute;
      }

      for (let i = 0; i < matchedShifts.length; i++) {
        const sh = matchedShifts[i];
        if (cursor < sh.start_minute) {
          const gapStart = cursor;
          const gapEnd = Math.min(sh.start_minute, session.endMinute);
          if (gapEnd > gapStart) {
            pushSegment(segments, gapEnd - gapStart > graceMinutes ? "overtime" : "normal", gapStart, gapEnd);
            cursor = gapEnd;
          }
        }
        const inStart = Math.max(cursor, sh.start_minute);
        const inEnd = Math.min(session.endMinute, sh.end_minute);
        if (inEnd > inStart) {
          pushSegment(segments, "normal", inStart, inEnd);
          cursor = inEnd;
        }
      }

      if (cursor < session.endMinute) {
        const tailDiff = session.endMinute - cursor;
        pushSegment(segments, tailDiff > graceMinutes ? "overtime" : "normal", cursor, session.endMinute);
      }
    }

    const overtime = segments
      .filter((seg) => seg.kind === "overtime")
      .reduce((sum, seg) => sum + (seg.endMinute - seg.startMinute), 0);

    const lateMinutes = matchedShifts.reduce((sum, sh) => sum + (shiftStats.get(sh.id)?.lateMinutes ?? 0), 0);
    const earlyLeaveMinutes = matchedShifts.reduce((sum, sh) => sum + (shiftStats.get(sh.id)?.earlyLeaveMinutes ?? 0), 0);

    return {
      sessionId: session.id,
      staffId: session.staff_id,
      startMinute: session.startMinute,
      endMinute: session.endMinute,
      actualStartLabel: session.actualStartLabel,
      actualEndLabel: session.actualEndLabel,
      isLive: session.isLive,
      isMissing: session.isMissing,
      isUnplanned: false,
      segments,
      lateMinutes,
      earlyLeaveMinutes,
      overtimeMinutes: overtime,
      matchedShiftIds: matchedShifts.map((s) => s.id),
    };
  });

  return {
    bars,
    gaps,
    totalLateMinutes: gaps.filter((g) => g.kind === "late").reduce((sum, g) => sum + g.minutes, 0),
    totalEarlyLeaveMinutes: gaps.filter((g) => g.kind === "earlyLeave").reduce((sum, g) => sum + g.minutes, 0),
    totalOvertimeMinutes: bars.reduce((sum, b) => sum + b.overtimeMinutes, 0),
    hasUnplanned: bars.some((b) => b.isUnplanned),
  };
}

export type DayScheduleStatus =
  | "정시"
  | "지각"
  | "조기퇴근"
  | "지각·조기퇴근"
  | "초과"
  | "무계획"
  | "근무 중"
  | "퇴근 누락"
  | "출근 예정"
  | "미출근"
  | "점주 근무";

export interface DayScheduleRow {
  id: string;
  staffId: string | null;
  shift?: Shift;
  typeLabel: string;
  plannedRange: string;
  actualRange: string;
  status: DayScheduleStatus;
  statusDetail: string;
  tone: "ok" | "warn" | "danger" | "info" | "muted";
}

export function buildDayScheduleRows(params: {
  day: string;
  today: string;
  currentMinute: number;
  timezone: string;
  nowIso: string;
  shifts: Shift[];
  sessions: WorkSession[];
  graceMinutes?: number;
}): DayScheduleRow[] {
  const { day, today, currentMinute, timezone, nowIso, shifts, sessions, graceMinutes = ATTENDANCE_GRACE_MINUTES } = params;
  const dayShifts = shifts
    .filter((s) => s.work_date === day)
    .sort((a, b) => a.start_minute - b.start_minute || a.end_minute - b.end_minute);

  const staffIds = new Set<string | null>(dayShifts.map((s) => s.staff_id));
  for (const sess of sessions) {
    const startDay = storeDay(sess.started_at, timezone);
    const endDay = sess.missing ? startDay : storeDay(sess.ended_at ?? nowIso, timezone);
    if (startDay <= day && endDay >= day) {
      staffIds.add(sess.staff_id);
    }
  }

  const analyses = new Map<string, DayTimelineAnalysis>();
  for (const staffId of staffIds) {
    if (!staffId) continue;
    const personShifts = dayShifts.filter((s) => s.staff_id === staffId);
    const personSessions = sessionsForDay(
      sessions.filter((s) => s.staff_id === staffId),
      personShifts,
      day,
      timezone,
      nowIso,
    );
    analyses.set(
      staffId,
      analyzeDayTimeline(
        personShifts,
        personSessions,
        graceMinutes,
        day === today ? currentMinute : undefined,
      ),
    );
  }

  const rows: DayScheduleRow[] = [];

  for (const shift of dayShifts) {
    const plannedRange = timeRange(clock(shift.start_minute), clock(shift.end_minute));
    if (!shift.staff_id) {
      rows.push({
        id: `shift-${shift.id}`,
        staffId: null,
        shift,
        typeLabel: shift.label,
        plannedRange,
        actualRange: "-",
        status: "점주 근무",
        statusDetail: "",
        tone: "info",
      });
      continue;
    }

    const analysis = analyses.get(shift.staff_id);
    const matchedBars = (analysis?.bars ?? []).filter((b) => b.matchedShiftIds.includes(shift.id));
    if (!matchedBars.length) {
      const missed = day < today || (day === today && currentMinute > shift.end_minute + graceMinutes);
      const isLatePending = !missed && day === today && currentMinute > shift.start_minute + graceMinutes;
      const lateMinutes = isLatePending ? Math.min(currentMinute, shift.end_minute) - shift.start_minute : 0;
      rows.push({
        id: `shift-${shift.id}`,
        staffId: shift.staff_id,
        shift,
        typeLabel: shift.label,
        plannedRange,
        actualRange: "-",
        status: missed ? "미출근" : isLatePending ? "지각" : "출근 예정",
        statusDetail: isLatePending ? `지각 ${lateMinutes}분 · 미출근` : "",
        tone: missed || isLatePending ? "danger" : "muted",
      });
      continue;
    }

    const actualRange = matchedBars
      .map((b) => (b.isLive ? `${b.actualStartLabel} ~ 근무 중` : timeRange(b.actualStartLabel, b.actualEndLabel)))
      .join(", ");

    const hasMissing = matchedBars.some((b) => b.isMissing);
    const hasLive = matchedBars.some((b) => b.isLive);
    const late = matchedBars[0]?.lateMinutes ?? 0;
    const early = matchedBars[0]?.earlyLeaveMinutes ?? 0;
    const overtime = matchedBars.reduce((sum, b) => sum + b.overtimeMinutes, 0);

    const details: string[] = [];
    if (late > 0) details.push(`지각 ${late}분`);
    if (early > 0) details.push(`조기퇴근 ${early}분`);
    if (overtime > 0) details.push(`초과 ${overtime}분`);

    let status: DayScheduleStatus = "정시";
    let tone: DayScheduleRow["tone"] = "ok";
    if (hasMissing) {
      status = "퇴근 누락";
      tone = "warn";
    } else if (hasLive) {
      status = "근무 중";
      tone = late > 0 ? "danger" : overtime > 0 ? "warn" : "info";
    } else if (late > 0 && early > 0) {
      status = "지각·조기퇴근";
      tone = "danger";
    } else if (late > 0) {
      status = "지각";
      tone = "danger";
    } else if (early > 0) {
      status = "조기퇴근";
      tone = "danger";
    } else if (overtime > 0) {
      status = "초과";
      tone = "warn";
    }

    rows.push({
      id: `shift-${shift.id}`,
      staffId: shift.staff_id,
      shift,
      typeLabel: shift.label,
      plannedRange,
      actualRange,
      status,
      statusDetail: details.join(" · "),
      tone,
    });
  }

  for (const [staffId, analysis] of analyses) {
    for (const bar of analysis.bars) {
      if (!bar.isUnplanned) continue;
      rows.push({
        id: `unplanned-${bar.sessionId}`,
        staffId,
        typeLabel: "무계획 근무",
        plannedRange: "-",
        actualRange: bar.isLive ? `${bar.actualStartLabel} ~ 근무 중` : timeRange(bar.actualStartLabel, bar.actualEndLabel),
        status: bar.isMissing ? "퇴근 누락" : bar.isLive ? "근무 중" : "무계획",
        statusDetail: bar.isMissing ? "무계획 근무" : `${hours(bar.endMinute - bar.startMinute)}`,
        tone: "warn",
      });
    }
  }

  return rows;
}

export type SummaryStatusKey = "WORKING" | "EXPECTED" | "LATE" | "OUT" | "MISSING";

export interface SummaryStatusItem {
  staff_id: string;
  status: "WORKING" | "EXPECTED" | "OUT" | "MISSING" | "NONE";
}

export function computeTodayStatusCounts(params: {
  summary: SummaryStatusItem[];
  shifts: Shift[];
  sessions: WorkSession[];
  day: string;
  today: string;
  currentMinute: number;
  timezone: string;
  nowIso: string;
  graceMinutes?: number;
}): Record<SummaryStatusKey, number> {
  const {
    summary,
    shifts,
    sessions,
    day,
    today,
    currentMinute,
    timezone,
    nowIso,
    graceMinutes = ATTENDANCE_GRACE_MINUTES,
  } = params;
  const counts: Record<SummaryStatusKey, number> = {
    WORKING: 0,
    EXPECTED: 0,
    LATE: 0,
    OUT: 0,
    MISSING: 0,
  };

  for (const item of summary) {
    if (item.status === "MISSING") {
      counts.MISSING += 1;
      continue;
    }

    const personShifts = shifts.filter((s) => s.staff_id === item.staff_id && s.work_date === day);
    const personSessions = sessionsForDay(
      sessions.filter((s) => s.staff_id === item.staff_id),
      personShifts,
      day,
      timezone,
      nowIso,
    );
    const effectiveMinute = day === today ? currentMinute : day < today ? 1440 : undefined;
    const analysis = analyzeDayTimeline(personShifts, personSessions, graceMinutes, effectiveMinute);
    const isLateNotArrived =
      item.status === "EXPECTED" &&
      effectiveMinute !== undefined &&
      personShifts.some((sh) => {
        const hasOverlap = personSessions.some((sess) =>
          intervalsOverlap(sess.startMinute, sess.endMinute, sh.start_minute, sh.end_minute),
        );
        return !hasOverlap && effectiveMinute > sh.start_minute + graceMinutes;
      });

    if (isLateNotArrived || (day === today && analysis.totalLateMinutes > 0 && item.status === "EXPECTED")) {
      counts.LATE += 1;
    } else if (item.status === "WORKING") {
      counts.WORKING += 1;
    } else if (item.status === "EXPECTED") {
      counts.EXPECTED += 1;
    } else if (item.status === "OUT") {
      counts.OUT += 1;
    }
  }

  return counts;
}