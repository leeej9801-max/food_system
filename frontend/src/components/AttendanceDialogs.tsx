import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { Dialog } from "./Dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAttendanceQR, fetchQRStatus } from "../api/staffAccess";
import { StaffAccessManager } from "./StaffAccessManager";
import "../styles/staff-access.css";
import type { Attendance, CorrectionItem, Preset, Shift, ShiftTime, Staff, WorkSession } from "../api/attendance";
import { clock, dateLabel, hours, localTime, storeDay, timeRange, zonedInputToIso } from "../lib/attendance";

export function AttendanceInfo({ text }: { text: string }) {
  return <Tooltip content={text} touchTrigger="tap" focusTrigger="always" hasHoverIndication={false}><button type="button" className="info" aria-label={text}>i</button></Tooltip>;
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <Dialog label={title} onClose={onClose}><section className={`attendance-page attendance-modal modal ${wide ? "modal-wide" : ""}`}><div className="m-head"><h2>{title}</h2><button type="button" className="x" aria-label="닫기" onClick={onClose}>×</button></div>{children}</section></Dialog>;
}

export function StaffDialog({ onClose, onSave, busy, storeId }: { onClose: () => void; onSave: (staff: Omit<Staff, "id">) => Promise<void>; busy: boolean; storeId?: string }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Staff["role"]>("HALL");
  const [color, setColor] = useState("#2f6bff");
  const [error, setError] = useState("");
  return <Modal title="직원 등록" onClose={onClose}><form onSubmit={async (e) => { e.preventDefault(); setError(""); try { await onSave({ name: name.trim(), role, color }); onClose(); } catch (err) { setError((err as Error).message); } }}>
    <label className="field">이름<input className="inp" autoFocus required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} /></label>
    <div className="row2"><label className="field">역할<select className="inp" value={role} onChange={(e) => setRole(e.target.value as Staff["role"])}><option value="HALL">홀</option><option value="KITCHEN">주방</option></select></label><label className="field">직원 색<input className="inp" type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label></div>
    {error && <p role="alert" className="error">{error}</p>}<div className="m-foot"><Button label="취소" onClick={onClose} /><Button label="등록" type="submit" variant="primary" isLoading={busy} /></div>
  </form>{storeId && <StaffAccessManager storeId={storeId} />}</Modal>;
}

export function AttendanceQRDialog({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const client = useQueryClient();
  const qr = useQuery({ queryKey: ["attendance-qr", storeId], queryFn: () => fetchAttendanceQR(storeId), staleTime: 0, gcTime: 0, retry: false });
  const [since, setSince] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const status = useQuery({ queryKey: ["attendance-qr-status", storeId, since], queryFn: () => fetchQRStatus(storeId, since!), enabled: !!since, refetchInterval: (q) => q.state.data?.completed ? false : 2500 });
  const completed = status.data?.completed;
  const qrData = qr.data;
  const refetchQr = qr.refetch;
  useEffect(() => {
    if (!qrData || completed) return;
    const data = qrData;
    const seconds = Math.max(0, (Date.parse(data.expires_at) - Date.parse(data.server_now)) / 1000);
    const start = performance.now();
    const update = () => setRemaining(Math.max(0, Math.ceil(seconds - (performance.now() - start) / 1000)));
    const initial = setTimeout(() => { setSince((value) => value ?? data.server_now); update(); }, 0);
    const interval = setInterval(update, 250);
    const timeout = setTimeout(() => { void refetchQr(); }, seconds * 1000 + 100);
    return () => { clearTimeout(initial); clearInterval(interval); clearTimeout(timeout); };
  }, [qrData, refetchQr, completed]);
  useEffect(() => { if (completed) void client.invalidateQueries({ queryKey: ["attendance", storeId] }); }, [completed, client, storeId]);
  return <Modal title="출퇴근 QR 등록" onClose={onClose}><div className="attendance-qr">
    {completed ? <div className="qr-complete" role="status">{completed.name} 님<br />{completed.kind === "IN" ? "출근" : "퇴근"} 확인되었습니다</div> : <>
      <p>직원의 휴대폰 카메라로 스캔해 주세요.<br />본인 카카오 계정으로 출퇴근을 기록합니다.</p>
      {qr.data && remaining > 0 && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.data.svg)}`} alt="직원 출퇴근 등록 QR" />}
      <p className="qr-count">{qr.isFetching || remaining === 0 ? "QR 갱신 중…" : `${remaining}초 후 새 QR`}</p>
      <p className="note">출근·퇴근은 직원의 현재 상태에 따라 자동으로 결정됩니다.</p>
    </>}
    {(qr.error || status.error) && <><p className="error" role="alert">{(qr.error || status.error)?.message}</p><Button label="다시 불러오기" onClick={() => { void qr.refetch(); void status.refetch(); }} /></>}
    <p className="note">PROVISIONAL · 공개 데모에서는 점주 권한을 확인하지 않습니다.</p>
  </div><div className="m-foot"><Button label={completed ? "확인" : "닫기"} onClick={onClose} /></div></Modal>;
}

function Wheel({ label, options, value, onChange }: { label: string; options: string[]; value: number; onChange: (value: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    // Dialog가 열린 뒤에만 스크롤 높이가 생긴다.
    const openTimer = setTimeout(() => { if (ref.current) ref.current.scrollTop = value * 44; }, 0);
    return () => clearTimeout(openTimer);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <div ref={ref} className="wcol" role="listbox" aria-label={label} tabIndex={0} aria-activedescendant={`${label}-${value}`} onKeyDown={(e) => {
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) { e.preventDefault(); onChange(e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, value + (e.key === "ArrowDown" ? 1 : -1)))); }
  }} onScroll={() => { clearTimeout(timer.current); timer.current = setTimeout(() => { if (ref.current) onChange(Math.max(0, Math.min(options.length - 1, Math.round(ref.current.scrollTop / 44)))); }, 120); }}>
    <div className="pad" aria-hidden="true" />{options.map((option, index) => <div id={`${label}-${index}`} key={option} role="option" aria-selected={index === value} onClick={() => onChange(index)}>{option}</div>)}<div className="pad" aria-hidden="true" />
  </div>;
}

function TimeWheels({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const hour24 = Math.floor(value / 60) % 24;
  const ampm = hour24 >= 12 ? 1 : 0;
  const hour = hour24 % 12;
  const minute = value % 60 === 30 ? 1 : 0;
  return <div className="wgroup"><div className="wheel-label">{label}</div><div className="wcols">
    <Wheel label={`${label} 오전·오후`} options={["오전", "오후"]} value={ampm} onChange={(n) => onChange((n * 12 + hour) * 60 + minute * 30)} />
    <Wheel label={`${label} 시`} options={Array.from({ length: 12 }, (_, i) => String(i === 0 ? 12 : i))} value={hour} onChange={(n) => onChange((ampm * 12 + n) * 60 + minute * 30)} />
    <Wheel label={`${label} 분`} options={["00", "30"]} value={minute} onChange={(n) => onChange((ampm * 12 + hour) * 60 + n * 30)} />
  </div></div>;
}

export type ScheduleSelection = { staffId: string | null; dates: string[]; shift?: Shift; start?: number };
export function TimeDialog({ selection, name, presets, onClose, onSave, onDelete, onSavePresets, busy }: { selection: ScheduleSelection; name: string; presets: Preset[]; onClose: () => void; onSave: (time: ShiftTime) => Promise<void>; onDelete: () => Promise<void>; onSavePresets: (presets: Preset[]) => Promise<void>; busy: boolean }) {
  const [start, setStart] = useState(selection.shift?.start_minute ?? selection.start ?? 600);
  const [end, setEnd] = useState(selection.shift?.end_minute ?? Math.min(1440, (selection.start ?? 600) + 300));
  const [active, setActive] = useState("manual");
  const [editPresets, setEditPresets] = useState(false);
  const [drafts, setDrafts] = useState(presets);
  const [error, setError] = useState("");
  const valid = end - start >= 60;
  async function submit() {
    setError("");
    if (!valid) { setError("퇴근은 출근보다 최소 1시간 뒤여야 합니다."); return; }
    try { await onSave({ start_minute: start, end_minute: end, label: active === "manual" ? "수동 설정" : presets.find((p) => p.key === active)?.label ?? "수동 설정" }); onClose(); } catch (err) { setError((err as Error).message); }
  }
  return <Modal title={editPresets ? "타임 유형 편집" : "근무 시간 설정"} onClose={onClose} wide>
    <p className="stamp">{name} · {dateLabel(selection.dates[0])}{selection.dates.length > 1 && ` ~ ${dateLabel(selection.dates.at(-1)!)} · ${selection.dates.length}일`}</p>
    {editPresets ? <form onSubmit={async (e) => { e.preventDefault(); setError(""); if (drafts.some((p) => p.end_minute - p.start_minute < 60 || p.start_minute % 30 || p.end_minute % 30)) { setError("유형은 30분 단위, 최소 1시간으로 설정해 주세요."); return; } try { await onSavePresets(drafts); setEditPresets(false); } catch (err) { setError((err as Error).message); } }}>
      {drafts.map((preset, index) => <div className="preset-edit-row" key={preset.key}><label className="field">유형 이름<input className="inp" required maxLength={30} value={preset.label} onChange={(e) => setDrafts(drafts.map((p, i) => i === index ? { ...p, label: e.target.value } : p))} /></label><label className="field">출근<input className="inp" type="time" step={1800} required value={clock(preset.start_minute)} onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); setDrafts(drafts.map((p, i) => i === index ? { ...p, start_minute: h * 60 + m } : p)); }} /></label><label className="field">퇴근<select className="inp" value={preset.end_minute} onChange={(e) => setDrafts(drafts.map((p, i) => i === index ? { ...p, end_minute: Number(e.target.value) } : p))}>{Array.from({ length: 47 }, (_, i) => (i + 2) * 30).map((n) => <option key={n} value={n}>{clock(n)}</option>)}</select></label></div>)}
      {error && <p className="error" role="alert">{error}</p>}<div className="m-foot"><Button label="돌아가기" onClick={() => setEditPresets(false)} /><Button label="유형 저장" variant="primary" type="submit" isLoading={busy} /></div>
    </form> : <>
      <div className="field"><span>빠른 선택</span><div className="presets"><button className={`preset ${active === "manual" ? "on" : ""}`} onClick={() => setActive("manual")}>수동 설정<small>직접 고르기</small></button>{presets.map((preset) => <button key={preset.key} className={`preset ${active === preset.key ? "on" : ""}`} onClick={() => { setStart(preset.start_minute); setEnd(preset.end_minute); setActive(preset.key); }}>
        {preset.label}<small>{timeRange(clock(preset.start_minute), clock(preset.end_minute))}</small></button>)}<button className="preset edit" onClick={() => { setDrafts(presets); setEditPresets(true); }}>유형 편집</button></div></div>
      <div className="wheels"><TimeWheels label="출근" value={start} onChange={(n) => { setStart(n); setActive("manual"); }} /><TimeWheels label="퇴근" value={end} onChange={(n) => { setEnd(n); setActive("manual"); }} /></div>
      <label className="midnight"><input type="checkbox" checked={end === 1440} onChange={(e) => { setEnd(e.target.checked ? 1440 : 1320); setActive("manual"); }} /> 자정에 퇴근 (24:00)</label>
      <p className={valid ? "time-summary" : "error"}>{timeRange(clock(start), clock(end))} · {valid ? hours(end - start) : "최소 1시간으로 설정해 주세요"}</p>
      {error && <p className="error" role="alert">{error}</p>}<div className="m-foot">{selection.shift && <Button label="스케줄 삭제" variant="destructive" clickAction={async () => { try { await onDelete(); onClose(); } catch (err) { setError((err as Error).message); } }} />}<Button label="취소" onClick={onClose} /><Button label={selection.shift ? "저장" : "등록"} variant="primary" isLoading={busy} isDisabled={!valid} onClick={() => void submit()} /></div>
    </>}
  </Modal>;
}

export function CorrectionDialog({ data, timezone, initialStaffId, onClose, onSave, busy }: { data: Attendance; timezone: string; initialStaffId: string; onClose: () => void; onSave: (staff: string, reason: string, items: CorrectionItem[]) => Promise<void>; busy: boolean }) {
  const [staffId, setStaffId] = useState(initialStaffId);
  const sessions = data.sessions.filter((s) => s.staff_id === staffId);
  const [sessionId, setSessionId] = useState(sessions.at(-1)?.in_id ?? "new");
  return <Modal title="출퇴근 수동 수정" onClose={onClose} wide><label className="field">직원<select className="inp" value={staffId} onChange={(e) => { setStaffId(e.target.value); setSessionId(data.sessions.filter((s) => s.staff_id === e.target.value).at(-1)?.in_id ?? "new"); }}>{data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label className="field">수정할 기록<select className="inp" value={sessionId} onChange={(e) => setSessionId(e.target.value)}><option value="new">누락 기록 추가</option>{sessions.map((s) => <option key={s.in_id} value={s.in_id}>{dateLabel(storeDay(s.started_at, timezone))} {timeRange(localTime(s.started_at, timezone), s.ended_at ? localTime(s.ended_at, timezone) : "퇴근 누락/근무 중")}</option>)}</select></label>
    <CorrectionForm key={`${staffId}-${sessionId}`} data={data} session={sessions.find((s) => s.in_id === sessionId)} staffId={staffId} timezone={timezone} onClose={onClose} onSave={onSave} busy={busy} />
  </Modal>;
}

function CorrectionForm({ data, session, staffId, timezone, onClose, onSave, busy }: { data: Attendance; session?: WorkSession; staffId: string; timezone: string; onClose: () => void; onSave: (staff: string, reason: string, items: CorrectionItem[]) => Promise<void>; busy: boolean }) {
  const input = (value: string) => `${storeDay(value, timezone)}T${localTime(value, timezone)}`;
  const [entry, setEntry] = useState(session ? input(session.started_at) : "");
  const [exit, setExit] = useState(session?.ended_at ? input(session.ended_at) : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const history = data.corrections.filter((c) => c.staff_id === staffId);
  const original = data.events.filter((e) => e.id === session?.in_event_id || e.id === session?.out_event_id);
  return <form onSubmit={async (e) => {
    e.preventDefault(); setError("");
    try {
      const started = session && entry === input(session.started_at) ? new Date(session.started_at).toISOString() : zonedInputToIso(entry, timezone);
      const ended = session?.ended_at && exit === input(session.ended_at) ? new Date(session.ended_at).toISOString() : exit ? zonedInputToIso(exit, timezone) : null;
      if (ended && ended <= started) throw new Error("퇴근은 출근보다 늦어야 합니다.");
      if (!reason.trim()) throw new Error("정정 사유를 입력해 주세요.");
      const items: CorrectionItem[] = [];
      if (!session || started !== new Date(session.started_at).toISOString()) items.push({ event_id: session?.in_event_id, previous_correction_id: session && !session.in_event_id ? session.in_id : null, corrected_kind: "IN", corrected_at: started });
      if (ended && (!session?.ended_at || ended !== new Date(session.ended_at).toISOString())) items.push({ event_id: session?.out_event_id, previous_correction_id: session?.out_id && !session.out_event_id ? session.out_id : null, corrected_kind: "OUT", corrected_at: ended });
      if (session?.ended_at && !ended) throw new Error("기존 퇴근 기록을 삭제할 수 없습니다.");
      if (!items.length) throw new Error("변경할 시간을 입력해 주세요.");
      await onSave(staffId, reason.trim(), items); onClose();
    } catch (err) { setError((err as Error).message); }
  }}>
    <p className="orig">원본 기록: {original.length ? original.map((e) => `${e.kind === "IN" ? "출근" : "퇴근"} ${dateLabel(storeDay(e.occurred_at, timezone))} ${localTime(e.occurred_at, timezone)}`).join(" / ") : "원본 없음 · 누락 기록 추가"}</p>
    <div className="row2"><label className="field">출근 일자·시간<input className="inp" type="datetime-local" required value={entry} onChange={(e) => setEntry(e.target.value)} /></label><label className="field">퇴근 일자·시간<input className="inp" type="datetime-local" value={exit} onChange={(e) => setExit(e.target.value)} /></label></div>
    <label className="field">정정 사유 (필수)<textarea className="inp ta" required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="수정한 이유를 남겨 주세요" /></label>
    <label className="field">점주 비밀번호 재확인<input className="inp" type="password" disabled placeholder="PROVISIONAL · 로그인 구현 후 제공" /></label><p className="note">PROVISIONAL · 현재는 점주 권한과 비밀번호를 확인하지 않습니다.</p>
    <details><summary>원본·정정 이력 전체 ({data.events.filter((e) => e.staff_id === staffId).length + history.length})</summary><ol className="history">{data.events.filter((e) => e.staff_id === staffId).map((e) => <li key={e.id}>원본 · {e.kind === "IN" ? "출근" : "퇴근"} · {dateLabel(storeDay(e.occurred_at, timezone))} {localTime(e.occurred_at, timezone)}</li>)}{history.map((c) => <li key={c.id}>정정 · {c.corrected_kind === "IN" ? "출근" : "퇴근"} · {dateLabel(storeDay(c.corrected_at, timezone))} {localTime(c.corrected_at, timezone)} · {c.reason}</li>)}</ol></details>
    {error && <p className="error" role="alert">{error}</p>}<div className="m-foot"><Button label="취소" onClick={onClose} /><Button label="정정 저장" type="submit" variant="primary" isLoading={busy} /></div>
  </form>;
}
