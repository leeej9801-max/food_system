import { z } from "zod";
import { apiRequest } from "./client";

const staffSchema = z.object({ id: z.string().uuid(), name: z.string(), role: z.enum(["HALL", "KITCHEN"]), color: z.string() });
const timeSchema = z.object({ start_minute: z.number(), end_minute: z.number(), label: z.string() });
const shiftSchema = timeSchema.extend({ id: z.string().uuid(), staff_id: z.string().uuid().nullable(), work_date: z.string() });
const presetSchema = timeSchema.extend({ key: z.enum(["AM", "PM", "OPEN", "CLOSE"]) });
const eventSchema = z.object({ id: z.string().uuid(), staff_id: z.string().uuid(), kind: z.enum(["IN", "OUT"]), occurred_at: z.string(), created_at: z.string(), device_id: z.string().nullable() });
const correctionSchema = z.object({ id: z.string().uuid(), staff_id: z.string().uuid(), event_id: z.string().uuid().nullable(), previous_correction_id: z.string().uuid().nullable(), corrected_kind: z.enum(["IN", "OUT"]), corrected_at: z.string(), reason: z.string(), corrected_by_user_id: z.string().nullable(), created_at: z.string() });
const sessionSchema = z.object({ staff_id: z.string().uuid(), in_id: z.string().uuid(), out_id: z.string().uuid().nullable(), in_event_id: z.string().uuid().nullable(), out_event_id: z.string().uuid().nullable(), started_at: z.string(), ended_at: z.string().nullable(), minutes: z.number().nullable(), missing: z.boolean() });
export const attendanceSchema = z.object({
  start: z.string(), end: z.string(), now: z.string(), provisional: z.boolean(),
  staff: z.array(staffSchema), shifts: z.array(shiftSchema), presets: z.array(presetSchema),
  events: z.array(eventSchema), corrections: z.array(correctionSchema), sessions: z.array(sessionSchema),
  summary: z.array(z.object({ staff_id: z.string().uuid(), planned_minutes: z.number(), actual_minutes: z.number(), overtime_minutes: z.number(), missing_count: z.number(), last_kind: z.enum(["IN", "OUT"]).nullable(), status: z.enum(["WORKING", "EXPECTED", "OUT", "MISSING", "NONE"]) })),
  gaps: z.array(z.object({ work_date: z.string(), started_at: z.string(), ended_at: z.string() })),
});

export type Staff = z.infer<typeof staffSchema>;
export type ShiftTime = z.infer<typeof timeSchema>;
export type Shift = z.infer<typeof shiftSchema>;
export type Preset = z.infer<typeof presetSchema>;
export type Attendance = z.infer<typeof attendanceSchema>;
export type WorkSession = z.infer<typeof sessionSchema>;
export type CorrectionItem = { event_id?: string | null; previous_correction_id?: string | null; corrected_kind: "IN" | "OUT"; corrected_at: string };

const path = (store: string) => `/stores/${store}/attendance`;
export function fetchAttendance(store: string, start: string, end: string) {
  return apiRequest(attendanceSchema, `${path(store)}?start=${start}&end=${end}`);
}
export function createStaff(store: string, payload: Omit<Staff, "id">) {
  return apiRequest(staffSchema, `${path(store)}/staff`, { method: "POST", body: JSON.stringify(payload) });
}
export function saveShifts(store: string, payload: ShiftTime & { staff_id: string | null; dates: string[] }) {
  return apiRequest(z.array(shiftSchema), `${path(store)}/shifts`, { method: "POST", body: JSON.stringify(payload) });
}
export function updateShift(store: string, id: string, payload: ShiftTime) {
  return apiRequest(shiftSchema, `${path(store)}/shifts/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}
export function deleteShift(store: string, id: string) {
  return apiRequest(z.object({ deleted: z.boolean() }), `${path(store)}/shifts/${id}`, { method: "DELETE" });
}
export function savePresets(store: string, presets: Preset[]) {
  return apiRequest(z.array(presetSchema), `${path(store)}/presets`, { method: "PUT", body: JSON.stringify({ presets }) });
}
export function recordAttendance(store: string, staff_id: string, kind: "IN" | "OUT", client_event_id = crypto.randomUUID()) {
  return apiRequest(eventSchema, `${path(store)}/events`, { method: "POST", body: JSON.stringify({ staff_id, kind, client_event_id }) });
}
export function correctAttendance(store: string, staff_id: string, reason: string, items: CorrectionItem[]) {
  return apiRequest(z.array(correctionSchema), `${path(store)}/corrections`, { method: "POST", body: JSON.stringify({ staff_id, reason, items }) });
}
