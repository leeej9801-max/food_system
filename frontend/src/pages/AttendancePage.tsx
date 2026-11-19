import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, type BadgeVariant } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Theme } from "@astryxdesign/core/theme";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import { themes, defaultThemeSlug } from "../astryx-themes";
import { correctAttendance, createStaff, deleteShift, fetchAttendance, savePresets, saveShifts, updateShift, type Attendance, type Shift, type Staff } from "../api/attendance";
import { AttendanceInfo, AttendanceQRDialog, CorrectionDialog, StaffDialog, TimeDialog, type ScheduleSelection } from "../components/AttendanceDialogs";
import {
  ATTENDANCE_GRACE_MINUTES,
  OWNER,
  WEEKDAYS,
  addDays,
  analyzeDayTimeline,
  buildDayScheduleRows,
  clock,
  dateLabel,
  daysBetween,
  hours,
  isClosed,
  localTime,
  monthGrid,
  navigatePeriod,
  overtimeMinutes,
  parseDay,
  periodFor,
  periodLabel,
  resizedTime,
  sessionsForDay,
  shortDateRange,
  storeDay,
  timeRange,
  type AttendanceView,
  type DayScheduleRow,
} from "../lib/attendance";
import type { Store } from "../types";
import "../styles/attendance.css";

export function AttendancePage({ store }: { store: Store }) {
  return <Theme theme={themes[defaultThemeSlug]} mode="light"><AttendanceScreen key={store.id} store={store} /></Theme>;
}

function Avatar({ person }: { person?: Staff }) {
  return <span className="av" style={{ background: person?.color ?? "#f2c27b", color: person ? "white" : "#5b3304" }}>{person?.name.slice(0, 1) ?? "점"}</span>;
}

function DatePicker({ day, view, today, onSelect, onClose }: { day: string; view: AttendanceView; today: string; onSelect: (day: string) => void; onClose: () => void }) {
  const [month, setMonth] = useState(day);
  const period = periodFor(day, view);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.parentElement?.contains(event.target)) onClose(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose]);
  return <div className="dp" ref={root} role="dialog" aria-label="날짜 선택" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
    <div className="dp-h"><button aria-label="이전 달" onClick={() => setMonth(navigatePeriod(month, "month", -1))}>‹</button>{periodLabel(month, "month")}<button aria-label="다음 달" onClick={() => setMonth(navigatePeriod(month, "month", 1))}>›</button></div>
    <div className="dp-g">{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}{monthGrid(month).map((date) => <button key={date} autoFocus={date === day} aria-label={dateLabel(date)} aria-pressed={date === day} className={`${date.slice(0, 7) !== month.slice(0, 7) ? "dim" : ""} ${date === today ? "today" : ""} ${view === "week" && date >= period.start && date <= period.end ? "inwk" : ""} ${date === day ? "on" : ""} ${parseDay(date).getDay() === 0 ? "sun" : parseDay(date).getDay() === 6 ? "sat" : ""}`} onClick={() => onSelect(date)} onKeyDown={(e) => {
      const delta = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : e.key === "ArrowDown" ? 7 : 0;
      if (delta) { e.preventDefault(); root.current?.querySelector<HTMLButtonElement>(`button[data-date="${addDays(date, delta)}"]`)?.focus(); }
    }} data-date={date}>{parseDay(date).getDate()}</button>)}</div>
  </div>;
}

function ResizableShift({ shift, onEdit, onResize, busy }: { shift: Shift; onEdit: () => void; onResize: (time: { start_minute: number; end_minute: number }) => Promise<void>; busy: boolean }) {
  const [preview, setPreview] = useState<{ start_minute: number; end_minute: number } | null>(null);
  const drag = useRef<{ x: number; width: number; edge: "start" | "end" } | null>(null);
  const value = preview ?? shift;
  const label = `${shift.label} ${timeRange(clock(value.start_minute), clock(value.end_minute))}`;
  function move(event: ReactPointerEvent) {
    const current = drag.current;
    if (current) setPreview(resizedTime(shift.start_minute, shift.end_minute, current.edge, (event.clientX - current.x) / current.width * 1440));
  }
  return <div className={`plan ${preview ? "edit" : ""} ${!shift.staff_id ? "s-owner" : ""}`} style={{ left: `${value.start_minute / 1440 * 100}%`, width: `${(value.end_minute - value.start_minute) / 1440 * 100}%` }}>
    <button
      type="button"
      className="plan-hit"
      onClick={onEdit}
      title={`${label} (클릭하여 근무시간 수정)`}
      aria-label={`${label} 근무시간 수정`}
    />
    {(["start", "end"] as const).map((edge) => <button key={edge} type="button" className={`hd ${edge === "start" ? "l" : "r"}`} title={`${label} · ${edge === "start" ? "출근" : "퇴근"} 시간 30분 단위 조절`} aria-label={`${edge === "start" ? "출근" : "퇴근"} 시간 30분 단위 조절`} disabled={busy} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, width: event.currentTarget.closest(".track")!.getBoundingClientRect().width, edge }; }} onPointerMove={move} onPointerCancel={() => { drag.current = null; setPreview(null); }} onPointerUp={async (event) => {
      if (!drag.current) return;
      const time = resizedTime(shift.start_minute, shift.end_minute, edge, (event.clientX - drag.current.x) / drag.current.width * 1440);
      drag.current = null;
      try { if (time.start_minute !== shift.start_minute || time.end_minute !== shift.end_minute) await onResize(time); } finally { setPreview(null); }
    }} onKeyDown={async (e) => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); await onResize(resizedTime(shift.start_minute, shift.end_minute, edge, e.key === "ArrowRight" ? 30 : -30)); } }} />)}
  </div>;
}

const TONE_BADGE: Record<DayScheduleRow["tone"], BadgeVariant> = {
  ok: "success",
  warn: "warning",
  danger: "error",
  info: "info",
  muted: "neutral",
};

function DayScheduleDialog({
  day,
  today,
  current,
  store,
  data,
  defaultStaffId,
  onClose,
  onEditShift,
  onEditAttendance,
}: {
  day: string | null;
  today: string;
  current: Date;
  store: Store;
  data: Attendance;
  defaultStaffId: string | null;
  onClose: () => void;
  onEditShift: (staffId: string | null, date: string, shift?: Shift) => void;
  onEditAttendance: (staffId: string) => void;
}) {
  const [hh, mm] = localTime(current, store.timezone).split(":").map(Number);
  const currentMinute = hh * 60 + mm;
  const rows = day
    ? buildDayScheduleRows({
        day,
        today,
        currentMinute,
        timezone: store.timezone,
        nowIso: data.now,
        shifts: data.shifts,
        sessions: data.sessions,
      })
    : [];
  const person = (id: string | null) => data.staff.find((s) => s.id === id);
  const nameOf = (id: string | null) => person(id)?.name ?? "점주 근무";
  const subtitleParts = day
    ? [
        `총 ${rows.length}건`,
        isClosed(day, store.business_days) ? "정기 휴무" : null,
        day === today ? "오늘" : null,
        `유예 ${ATTENDANCE_GRACE_MINUTES}분 기준`,
      ].filter(Boolean)
    : [];

  return (
    <Dialog
      isOpen={day !== null}
      onOpenChange={(open) => !open && onClose()}
      purpose="info"
      width="min(720px, calc(100vw - 32px))"
      aria-label={day ? `${dateLabel(day)} 상세 스케줄` : "상세 스케줄"}
    >
      {day && (
        <Layout
          header={
            <DialogHeader
              title={`${dateLabel(day)} 스케줄`}
              subtitle={subtitleParts.join(" · ")}
              onOpenChange={(open) => !open && onClose()}
            />
          }
          content={
            <LayoutContent>
              <div className="attendance-day-modal">
                {rows.length === 0 ? (
                  <p className="day-empty">이 날짜에 등록된 근무 스케줄이나 출퇴근 기록이 없습니다.</p>
                ) : (
                  <div className="day-table-wrap">
                    <table className="day-table">
                      <thead>
                        <tr>
                          <th scope="col">직원</th>
                          <th scope="col">유형</th>
                          <th scope="col">근무 시간</th>
                          <th scope="col">실제 출퇴근</th>
                          <th scope="col">상태</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const staff = person(row.staffId);
                          return (
                            <tr key={row.id}>
                              <td>
                                <span className="day-who">
                                  <span
                                    className="day-dot"
                                    style={{ background: staff?.color ?? "#f2c27b" }}
                                    aria-hidden="true"
                                  />
                                  <span>{nameOf(row.staffId)}</span>
                                </span>
                              </td>
                              <td>{row.typeLabel}</td>
                              <td className="num">
                                {row.shift ? (
                                  <button
                                    type="button"
                                    className="day-link"
                                    onClick={() => {
                                      onClose();
                                      onEditShift(row.staffId, day, row.shift);
                                    }}
                                  >
                                    {row.plannedRange}
                                  </button>
                                ) : (
                                  row.plannedRange
                                )}
                              </td>
                              <td className="num">
                                {row.staffId && row.actualRange !== "-" ? (
                                  <button
                                    type="button"
                                    className="day-link"
                                    onClick={() => {
                                      onClose();
                                      onEditAttendance(row.staffId!);
                                    }}
                                  >
                                    {row.actualRange}
                                  </button>
                                ) : (
                                  row.actualRange
                                )}
                              </td>
                              <td>
                                <div className="day-status">
                                  <Badge variant={TONE_BADGE[row.tone]} label={row.status} />
                                  {row.statusDetail && <small>{row.statusDetail}</small>}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <div className="day-modal-foot">
                <Button
                  label="＋ 근무 추가"
                  variant="secondary"
                  onClick={() => {
                    onClose();
                    onEditShift(defaultStaffId, day);
                  }}
                />
                <Button label="닫기" variant="primary" onClick={onClose} />
              </div>
            </LayoutFooter>
          }
        />
      )}
    </Dialog>
  );
}

function AttendanceScreen({ store }: { store: Store }) {
  const today = storeDay(new Date(), store.timezone);
  const [day, setDay] = useState(today);
  const [view, setView] = useState<AttendanceView>("week");
  const [calendar, setCalendar] = useState(false);
  const datePill = useRef<HTMLButtonElement>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pending, setPending] = useState<ScheduleSelection | null>(null);
  const [selection, setSelection] = useState<ScheduleSelection | null>(null);
  const [dayModal, setDayModal] = useState<string | null>(null);
  const [staffDialog, setStaffDialog] = useState(false);
  const [clockQr, setClockQr] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const [clockStaff, setClockStaff] = useState("");
  const [error, setError] = useState("");
  const [message] = useState("");
  const [tick, setTick] = useState(() => Date.now());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const drag = useRef<{ staffId: string | null; x: number; y: number; moved: boolean; extend?: string } | null>(null);
  const skipClick = useRef(false);
  const period = periodFor(day, view);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["attendance", store.id, period.start, period.end], queryFn: () => fetchAttendance(store.id, period.start, period.end), refetchInterval: 30_000 });
  const mutation = useMutation({ mutationFn: (action: () => Promise<unknown>) => action(), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["attendance", store.id] }); } });
  useEffect(() => { const timer = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const data = query.data;
  const busy = mutation.isPending;
  async function run(action: () => Promise<unknown>) { await mutation.mutateAsync(action); }
  async function guarded(action: () => Promise<unknown>) { setError(""); try { await run(action); } catch (err) { setError((err as Error).message); } }
  function closeCalendar() { setCalendar(false); datePill.current?.focus(); }
  function changeDay(date: string) { setDay(date); setPending(null); closeCalendar(); }
  function changeView(next: AttendanceView) { setView(next); setPending(null); setCalendar(false); setDayModal(null); }
  const names = (staffId: string | null) => data?.staff.find((p) => p.id === staffId)?.name ?? "점주 근무";
  const person = (id: string | null) => data?.staff.find((p) => p.id === id);
  function openTime(staffId: string | null, date: string, shift?: Shift) { setSelection({ staffId, dates: [date], shift }); }
  function targetAt(event: ReactPointerEvent) { return document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-attendance-drop]"); }
  function dragMove(event: ReactPointerEvent) {
    if (!drag.current) return;
    if (Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 5) drag.current.moved = true;
    const target = targetAt(event);
    setDropTarget(target?.dataset.date ?? null);
    if (drag.current.extend && target?.dataset.date) {
      const start = drag.current.extend, end = target.dataset.date;
      setPending({ staffId: drag.current.staffId, dates: daysBetween(start < end ? start : end, start < end ? end : start) });
    }
  }
  function dragEnd(event: ReactPointerEvent) {
    const current = drag.current;
    drag.current = null; setDropTarget(null);
    if (!current?.moved) return;
    skipClick.current = true;
    const target = targetAt(event), date = target?.dataset.date;
    if (!date || busy) return;
    if (current.extend) return;
    if (view === "week") setPending({ staffId: current.staffId, dates: [date] });
    else {
      const rect = target.getBoundingClientRect();
      const start = view === "day" ? Math.min(1380, Math.max(0, Math.round((event.clientX - rect.left) / rect.width * 48) * 30)) : undefined;
      setSelection({ staffId: current.staffId, dates: [date], start });
    }
  }
  if (query.isLoading) return <div className="attendance-page loading" role="status">근태 정보를 불러오는 중입니다...</div>;
  if (!data || query.isError) return <div className="attendance-page error" role="alert">{query.error?.message ?? "근태 정보를 불러오지 못했습니다."}<button onClick={() => void query.refetch()}>다시 시도</button></div>;
  const current = new Date(new Date(data.now).getTime() + Math.max(0, tick - query.dataUpdatedAt));
  const rows = [...data.staff.map((p) => p.id), OWNER];
  const employeeId = data.staff.some((s) => s.id === clockStaff) ? clockStaff : data.staff[0]?.id ?? "";
  const nextKind = data.summary.find((s) => s.staff_id === employeeId)?.last_kind === "IN" ? "OUT" : "IN";
  const missing = data.summary.filter((s) => s.missing_count);
  const actualTotal = data.summary.reduce((sum, s) => sum + s.actual_minutes, 0);
  const plannedTotal = data.summary.reduce((sum, s) => sum + s.planned_minutes, 0);
  const overtimeTotal = data.summary.reduce((sum, s) => sum + overtimeMinutes(s.actual_minutes, s.planned_minutes), 0);
  const maxMinutes = Math.max(60, ...data.summary.map((s) => Math.max(s.actual_minutes, s.planned_minutes)));
  const viewDays = view === "month" ? monthGrid(day) : daysBetween(period.start, period.end);
  function plans(staffId: string | null, date: string) { return data!.shifts.filter((s) => s.staff_id === staffId && s.work_date === date); }
  function focused(staffId: string | null) { return !highlight || highlight === (staffId ?? OWNER); }
  function shiftClass(shift: Shift) { return !shift.staff_id ? "s-owner" : shift.end_minute - shift.start_minute >= 480 ? "s-full" : shift.start_minute < 840 ? "s-am" : "s-pm"; }
  const spanStyle = (left: number, right: number) => ({ left: `${left / 1440 * 100}%`, width: `${Math.max(0, right - left) / 1440 * 100}%` });
  const business = store.opening_hours?.split("-").map((v) => { const [h, m] = v.split(":").map(Number); return h * 60 + m; });
  return <div className="attendance-page">
    <header className="head"><h1>근태 관리</h1><div className="datenav"><button className="icon-btn" aria-label="이전 기간" onClick={() => changeDay(navigatePeriod(day, view, -1))}>‹</button><div className="dp-wrap"><button ref={datePill} className={`date-pill ${calendar ? "open" : ""}`} aria-expanded={calendar} aria-haspopup="dialog" onClick={() => setCalendar(!calendar)}>{periodLabel(day, view)}</button>{calendar && <DatePicker day={day} view={view} today={today} onSelect={changeDay} onClose={closeCalendar} />}</div><button className="icon-btn" aria-label="다음 기간" onClick={() => changeDay(navigatePeriod(day, view, 1))}>›</button><button className="today-btn" onClick={() => changeDay(today)}>오늘</button></div>
      <div className="seg" role="group" aria-label="스케줄 보기">{([['day', '일간'], ['week', '주간'], ['month', '월간']] as const).map(([value, label]) => <button key={value} aria-pressed={view === value} className={view === value ? "on" : ""} onClick={() => changeView(value)}>{label}</button>)}</div></header>
    {missing.length > 0 && <div className="alert">퇴근 기록이 없는 직원 {missing.length}명 ({missing.map((s) => names(s.staff_id)).join(", ")}). 누락 시간은 미산출이에요.<button onClick={() => setManual(missing[0].staff_id)}>수동 수정</button></div>}
    {error && <div className="alert error" role="alert">{error}<button onClick={() => setError("")}>닫기</button></div>}{message && <p role="status" className="notice">{message}</p>}
    <div className="roster"><span className="lbl">직원 명단</span>{rows.map((id) => { const staff = person(id); return <Fragment key={id}><button className={`person ${!staff ? "owner" : ""} ${highlight === id ? "sel" : ""}`} aria-pressed={highlight === id} onPointerDown={(e) => { if (busy || (e.target instanceof Element && e.target.closest(".info"))) return; skipClick.current = false; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { staffId: staff?.id ?? null, x: e.clientX, y: e.clientY, moved: false }; }} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={() => { drag.current = null; setDropTarget(null); }} onClick={() => { if (skipClick.current) { skipClick.current = false; return; } setHighlight(highlight === id ? null : id); }}><Avatar person={staff} />{staff?.name ?? "점주 근무"}{staff && <small>{staff.role === "HALL" ? "홀" : "주방"}</small>}</button>{id === OWNER && <AttendanceInfo text="가게 직원 없이 점주 홀로 근무하는 시간이에요. 스케줄 공백에서 빠져요." />}</Fragment>; })}
      {!data.staff.length && <button className="today-btn" onClick={() => setStaffDialog(true)}>첫 직원 등록</button>}
      <span className="hint">명단을 날짜로 끌어 놓으세요</span>{pending && <div className="roster-act on"><span><b>{names(pending.staffId)}</b> · {pending.dates[0] === pending.dates.at(-1) ? pending.dates[0] : `${pending.dates[0]} ~ ${pending.dates.at(-1)}`} · {pending.dates.length}일</span><button onClick={() => setPending(null)}>취소</button><button className="pill pill-p" onClick={() => setSelection(pending)}>시간 설정하기</button></div>}
    </div>
    <section className={`card board ${highlight ? "has-sel" : ""}`} aria-label="스케줄" onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={() => { drag.current = null; setDropTarget(null); }}><div className="card-title">{view === "day" ? "오늘 근무 · 근무 전체 시간과 실제" : view === "week" ? "주간 스케줄 · 칸을 눌러 근무시간 설정" : "월간 스케줄"}<div className="legend">{view === "day" ? <><span><i className="sw sw-plan" />근무 전체 시간</span><span><i className="sw sw-act" />실제 출퇴근</span><span><i className="sw sw-late" />지각·조기퇴근</span><span><i className="sw sw-over" />초과</span><span><i className="sw sw-miss" />퇴근 누락</span></> : <><span><i className="sw s-am" />오전</span><span><i className="sw s-pm" />오후</span><span><i className="sw s-full" />풀타임</span></>}</div></div>
      <div className="board-scroll">
      {view === "day" && <div className="day"><div className="tl-head"><span /><div className="axis"><span className="ampm" style={{ left: 0 }}>AM</span><span className="ampm" style={{ left: "50%" }}>PM</span>{Array.from({ length: 9 }, (_, i) => <span className="hr" key={i} style={{ left: `${i / 8 * 100}%` }}>{i % 4 === 0 ? 12 : i % 4 * 3}</span>)}</div></div>
        {rows.map((id) => {
          const staffId = id === OWNER ? null : id;
          const staff = person(staffId);
          const shifts = plans(staffId, day);
          const staffSessions = staffId ? sessionsForDay(data.sessions.filter((s) => s.staff_id === staffId), shifts, day, store.timezone, data.now) : [];
          const analysis = staffId ? analyzeDayTimeline(shifts, staffSessions) : null;
          return <div className={`tl-row ${focused(staffId) ? "hl" : "dim-row"}`} key={id}><button className="who" onClick={() => openTime(staffId, day)}><Avatar person={staff} /><span><b>{names(staffId)}</b><small>{shifts.length ? shifts.map((s) => `${timeRange(clock(s.start_minute), clock(s.end_minute))}`).join(" / ") : staffId ? "근무시간 설정" : "점주 홀로 근무"}</small></span></button>
          <div className={`track ${dropTarget === day ? "drop-hi" : ""}`} data-attendance-drop="day" data-date={day}><div className="grid-bg" />{isClosed(day, store.business_days) ? <div className="closed" style={{ inset: 0 }} /> : business && (business[1] > business[0] ? <><div className="closed" style={spanStyle(0, business[0])} /><div className="closed" style={spanStyle(business[1], 1440)} /></> : <div className="closed" style={spanStyle(business[1], business[0])} />)}
            {shifts.map((shift) => <ResizableShift key={shift.id} shift={shift} onEdit={() => openTime(staffId, day, shift)} busy={busy} onResize={async (time) => { await guarded(() => updateShift(store.id, shift.id, { ...time, label: "수동 설정" })); }} />)}
            {analysis?.gaps.map((gap) => {
              const gapLabel = gap.kind === "late" ? `지각 ${gap.minutes}분` : `조기퇴근 ${gap.minutes}분`;
              const compact = gap.endMinute - gap.startMinute < 80;
              return (
                <div
                  key={`${gap.kind}-${gap.startMinute}-${gap.endMinute}`}
                  className={`gap-warn ${gap.kind === "late" ? "late" : "early"} ${compact ? "compact" : ""}`}
                  style={spanStyle(gap.startMinute, gap.endMinute)}
                  title={gapLabel}
                >
                  <span>{gapLabel}</span>
                </div>
              );
            })}
            {analysis?.bars.map((bar) => {
              const totalSpan = Math.max(1, bar.endMinute - bar.startMinute);
              const barText = bar.isMissing
                ? timeRange(bar.actualStartLabel, "퇴근 누락")
                : bar.isLive
                  ? `${bar.actualStartLabel}~`
                  : timeRange(bar.actualStartLabel, bar.actualEndLabel);
              const detailParts = [
                bar.isUnplanned ? "무계획 근무" : null,
                bar.lateMinutes > 0 ? `지각 ${bar.lateMinutes}분` : null,
                bar.earlyLeaveMinutes > 0 ? `조기퇴근 ${bar.earlyLeaveMinutes}분` : null,
                bar.overtimeMinutes > 0 && !bar.isUnplanned ? `초과 ${bar.overtimeMinutes}분` : null,
              ].filter(Boolean);
              const plannedSummary = shifts.length
                ? `계획 ${shifts.map((s) => timeRange(clock(s.start_minute), clock(s.end_minute))).join(", ")} · `
                : "";
              const tooltip = `${plannedSummary}실제 ${barText}${detailParts.length ? ` (${detailParts.join(", ")})` : ""}`;
              const darkText = bar.isMissing || bar.isUnplanned || bar.segments.every((seg) => seg.kind === "overtime");
              const widthPct = Math.max(0.6, (bar.endMinute - bar.startMinute) / 1440 * 100);
              return (
                <button
                  type="button"
                  key={bar.sessionId}
                  className={`act act-bar ${bar.isLive ? "live" : ""} ${bar.isMissing ? "miss" : ""} ${darkText ? "dark-ink" : ""}`}
                  style={{ left: `${bar.startMinute / 1440 * 100}%`, width: `${widthPct}%` }}
                  onClick={() => setManual(bar.staffId)}
                  title={tooltip}
                >
                  <span className="act-segs" aria-hidden="true">
                    {bar.segments.map((seg, idx) => {
                      const segPct = bar.endMinute === bar.startMinute ? 100 : (seg.endMinute - seg.startMinute) / totalSpan * 100;
                      const isLast = idx === bar.segments.length - 1;
                      return (
                        <span
                          key={`${seg.kind}-${seg.startMinute}-${idx}`}
                          className={`act-seg seg-${seg.kind} ${bar.isLive && isLast ? "live-tail" : ""}`}
                          style={{ width: `${segPct}%` }}
                        />
                      );
                    })}
                  </span>
                  <span className="act-txt">{barText}</span>
                </button>
              );
            })}
            {day === today && (() => { const hhmm = localTime(current, store.timezone); const pct = (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) / 1440 * 100; const align = pct < 5 ? "left" : pct > 95 ? "right" : "center"; return <div className={`now ${align}`} style={{ left: `${pct}%` }}><span>지금 {hhmm}</span></div>; })()}
          </div></div>; })}</div>}
      {view === "week" && <div className="week"><div className="wh">직원</div>{viewDays.map((date, index) => <div className={`wh ${date === today ? "today" : ""} ${index === 6 ? "sun" : index === 5 ? "sat" : ""}`} key={date}>{WEEKDAYS[index]}<b>{parseDay(date).getDate()}</b></div>)}
        {rows.map((id) => { const staffId = id === OWNER ? null : id, summary = data.summary.find((s) => s.staff_id === staffId); return <Fragment key={id}><div className={`who ${focused(staffId) ? "hl" : "dim-row"}`}><Avatar person={person(staffId)} /><span><b>{names(staffId)}</b><small>{summary ? hours(summary.planned_minutes) : "점주 홀로 근무"}</small></span></div>{viewDays.map((date) => <div key={date} data-attendance-drop="week" data-date={date} className={`week-cell ${isClosed(date, store.business_days) ? "off" : ""} ${dropTarget === date ? "drop-hi" : ""} ${focused(staffId) ? "hl" : "dim-row"}`}>
          {plans(staffId, date).map((shift) => <button key={shift.id} className={`shift ${shiftClass(shift)}`} onClick={() => openTime(staffId, date, shift)}>{shift.label}<small>{timeRange(clock(shift.start_minute), clock(shift.end_minute))}</small></button>)}
          {pending?.staffId === staffId && pending.dates.includes(date) && <div className="shift s-pend">{names(staffId)}<small>시간 미설정</small>{date === pending.dates.at(-1) && <button className="extend" aria-label="근무 기간 확장" onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.closest(".board")!.setPointerCapture(e.pointerId); drag.current = { staffId, x: e.clientX, y: e.clientY, moved: false, extend: pending.dates[0] }; }} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={() => { drag.current = null; }} onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const end = addDays(pending.dates.at(-1)!, e.key === "ArrowRight" ? 1 : -1); if (end >= pending.dates[0] && end <= period.end) setPending({ ...pending, dates: daysBetween(pending.dates[0], end) }); } }} />}</div>}
          <button className="add" aria-label={`${names(staffId)} ${dateLabel(date)} 근무 추가`} onClick={() => { setPending({ staffId, dates: [date] }); }}>＋</button>
        </div>)}</Fragment>; })}</div>}
      {view === "month" && <div className="month">{WEEKDAYS.map((label, index) => <div className={`mh ${index === 5 ? "sat" : index === 6 ? "sun" : ""}`} key={label}>{label}</div>)}{viewDays.map((date) => {
        const dayShifts = data.shifts
          .filter((s) => s.work_date === date)
          .sort((a, b) => a.start_minute - b.start_minute || a.end_minute - b.end_minute);
        const visibleShifts = dayShifts.slice(0, 2);
        const overflow = dayShifts.length - visibleShifts.length;
        const dayOfWeek = parseDay(date).getDay();
        return <div
          key={date}
          data-attendance-drop="month"
          data-date={date}
          className={`md ${date.slice(0, 7) !== day.slice(0, 7) ? "dim" : ""} ${date === today ? "today" : ""} ${date === day ? "picked" : ""} ${dayOfWeek === 0 ? "sun" : dayOfWeek === 6 ? "sat" : ""} ${isClosed(date, store.business_days) ? "off" : ""} ${dropTarget === date ? "drop-hi" : ""}`}
          onClick={() => {
            if (skipClick.current) { skipClick.current = false; return; }
            setDay(date);
            setDayModal(date);
          }}
        >
          <div className="n">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setDay(date); setDayModal(date); }}
              aria-label={`${dateLabel(date)} 상세 스케줄 보기`}
            >{parseDay(date).getDate()}</button>
            {overflow > 0 && <span className="more-n" aria-label={`외 ${overflow}건`}>+{overflow}</span>}
            {isClosed(date, store.business_days) && <span className="tag">휴무</span>}
            {date === today && <span className="tag">오늘</span>}
          </div>
          {visibleShifts.map((shift) => <button key={shift.id} type="button" className={`chip ${shiftClass(shift)} ${focused(shift.staff_id) ? "hl" : "dim-row"}`} onClick={(e) => { e.stopPropagation(); openTime(shift.staff_id, date, shift); }}><b>{names(shift.staff_id)}</b><em>{shift.label}</em><small>{timeRange(clock(shift.start_minute), clock(shift.end_minute))}</small></button>)}
        </div>;
      })}</div>}
      </div>
    </section>
    <aside className="panel"><div className="stack"><section className="card clock"><div className="card-title">출·퇴근 <AttendanceInfo text="PROVISIONAL · 점주 화면에서 서버 시각으로 직접 기록합니다." /><span className="tag">PROVISIONAL</span></div><div className="now-time">{new Intl.DateTimeFormat("en-GB", { timeZone: store.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(current)}</div><div className="now-date">{dateLabel(storeDay(current, store.timezone))}</div>
      <label className="clock-select"><span className="sr-only">출퇴근 등록 직원</span><select className="sel" value={employeeId} onChange={(e) => setClockStaff(e.target.value)} disabled={!employeeId || busy}>{!data.staff.length && <option value="">직원을 등록해 주세요</option>}{data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><span className="clock-status">{nextKind === "OUT" ? "근무 중" : "출근 전"}</span></label>
      <button className="clock-btn" disabled={!employeeId || busy} onClick={() => setClockQr(true)}>{busy ? "저장 중..." : nextKind === "IN" ? "출근 등록" : "퇴근 등록"}</button><button className="manual" disabled={!employeeId} onClick={() => setManual(employeeId)}>출퇴근 수동 수정 (점주)</button></section><button className="reg-btn" onClick={() => setStaffDialog(true)}>＋ 직원 등록</button></div>
      <section className="card work-hours"><div className="card-title">{view === "week" ? "이번 주 근무시간" : view === "day" ? "선택일 근무시간" : "이번 달 근무시간"}<AttendanceInfo text="실제 근무시간을 합산합니다. 퇴근 누락은 미산출이며, 실제 근무가 선택 기간의 근무 전체 시간(계획)을 넘은 시간만 초과로 표시합니다. 휴게·수당 계산은 하지 않습니다." /><span className="r">{shortDateRange(period.start, period.end)}</span></div><div className="ot">{data.summary.map((summary) => { const over = overtimeMinutes(summary.actual_minutes, summary.planned_minutes); return <div className="wk-row" key={summary.staff_id}><span>{names(summary.staff_id)}</span><span className="wk-bar"><i style={{ width: `${summary.actual_minutes / maxMinutes * 100}%` }} />{over > 0 && <u style={{ left: `${summary.planned_minutes / maxMinutes * 100}%`, width: `${over / maxMinutes * 100}%` }} />}</span><em className={over > 0 ? "over" : ""}>{hours(summary.actual_minutes)}{summary.missing_count > 0 && <small>누락 미산출</small>}<AttendanceInfo text={`근무 전체 시간 ${hours(summary.planned_minutes)}${over > 0 ? ` · 초과 ${hours(over)}` : ""}`} /></em></div>; })}{!data.staff.length && <p className="empty">직원을 등록하면 근무시간을 확인할 수 있어요.</p>}</div><div className="wk-total"><span>합계 · 전체 {hours(plannedTotal)}</span><span><b>{hours(actualTotal)}</b> · 초과 {hours(overtimeTotal)}</span></div></section>
      <div className="rcol"><section className="card"><div className="card-title">{view === "day" && day === today ? "오늘 현황" : "선택 기간 현황"}<span className="r">{view === "day" ? day.slice(5).replace("-", ".") : view === "week" ? "이번 주" : "이번 달"}</span></div><div className="today-st">{([['WORKING', '근무 중'], ['EXPECTED', '출근 예정'], ['OUT', '퇴근'], ['MISSING', '기록 누락']] as const).map(([status, label]) => <div key={status} className={status === "MISSING" ? "warn" : ""}><b>{data.summary.filter((s) => s.status === status).length}</b>{label}</div>)}</div></section>
      <section className="card gaps-card"><div className="card-title">스케줄 공백<AttendanceInfo text="영업시간인데 직원이 0명이고 점주 근무도 아닌 시간대입니다. 휴무일과 점주 근무는 공백에서 제외합니다." /><span className="r">선택 기간</span></div><div className="big">{data.gaps.length}<small>건</small></div>{!store.opening_hours || !store.business_days ? <p className="note">영업일·영업시간을 설정하면 공백을 계산합니다.</p> : !data.gaps.length ? <p className="note">선택 기간에 스케줄 공백이 없어요.</p> : <ul className="gap-list">{data.gaps.map((gap) => <li key={`${gap.work_date}-${gap.started_at}`}><span>{gap.work_date.slice(5).replace("-", ".")} {timeRange(localTime(gap.started_at, store.timezone), `${storeDay(gap.ended_at, store.timezone) !== gap.work_date ? "다음날 " : ""}${localTime(gap.ended_at, store.timezone)}`)}</span><b>배정 0명</b></li>)}</ul>}</section></div>
    </aside>
    <DayScheduleDialog
      day={dayModal}
      today={today}
      current={current}
      store={store}
      data={data}
      defaultStaffId={highlight === OWNER ? null : highlight ?? data.staff[0]?.id ?? null}
      onClose={() => setDayModal(null)}
      onEditShift={openTime}
      onEditAttendance={(staffId) => setManual(staffId)}
    />
    {clockQr && <AttendanceQRDialog storeId={store.id} onClose={() => setClockQr(false)} />}
    {staffDialog && <StaffDialog storeId={store.id} onClose={() => setStaffDialog(false)} busy={busy} onSave={async (staff) => run(() => createStaff(store.id, staff))} />}
    {selection && <TimeDialog key={`${selection.shift?.id ?? selection.staffId}-${selection.dates.join()}`} selection={selection} name={names(selection.staffId)} presets={data.presets} onClose={() => setSelection(null)} busy={busy} onSave={async (time) => { await run(() => selection.shift ? updateShift(store.id, selection.shift.id, time) : saveShifts(store.id, { ...time, staff_id: selection.staffId, dates: selection.dates })); setPending(null); }} onDelete={async () => { if (selection.shift) await run(() => deleteShift(store.id, selection.shift!.id)); }} onSavePresets={async (presets) => run(() => savePresets(store.id, presets))} />}
    {manual && data.staff.length > 0 && <CorrectionDialog data={data} timezone={store.timezone} initialStaffId={manual} onClose={() => setManual(null)} busy={busy} onSave={async (staffId, reason, items) => run(() => correctAttendance(store.id, staffId, reason, items))} />}
  </div>;
}
