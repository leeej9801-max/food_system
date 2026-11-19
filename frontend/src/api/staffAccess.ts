import { z } from "zod";
import { ApiClientError, apiRequest } from "./client";

const recordedSchema = z.object({ event_id: z.string().uuid(), name: z.string(), kind: z.enum(["IN", "OUT"]), occurred_at: z.string() });
const meSchema = z.object({ staff_id: z.string().uuid(), name: z.string(), status: z.enum(["PENDING", "ACTIVE"]) });
export type StaffMe = z.infer<typeof meSchema>;
export type RecordedAttendance = z.infer<typeof recordedSchema>;
const mobilePath = (store: string) => `/stores/${store}/staff-access`;
const ownerPath = (store: string) => `/stores/${store}/attendance`;
const post = (body?: unknown): RequestInit => ({ method: "POST", credentials: "include", body: body === undefined ? undefined : JSON.stringify(body) });

// 같은 탭의 동시 401은 한 번의 rotation으로 합친다.
const refreshes = new Map<string, Promise<unknown>>();
async function staffRequest<T>(store: string, schema: z.ZodType<T>, path: string, init?: RequestInit) {
  try { return await apiRequest(schema, mobilePath(store) + path, { ...init, credentials: "include" }); }
  catch (error) {
    if (!(error instanceof ApiClientError) || error.status !== 401) throw error;
    let refresh = refreshes.get(store);
    if (!refresh) {
      refresh = apiRequest(z.object({ refreshed: z.boolean() }), mobilePath(store) + "/refresh", post()).finally(() => refreshes.delete(store));
      refreshes.set(store, refresh);
    }
    await refresh;
    return apiRequest(schema, mobilePath(store) + path, { ...init, credentials: "include" });
  }
}

export const fetchStaffMe = (store: string) => staffRequest(store, meSchema, "/me");
export const recordStaffQR = (store: string, qr: string, clientEvent: string) => staffRequest(store, recordedSchema, "/record", post({ qr_token: qr, client_event_id: clientEvent }));
export const logoutStaff = (store: string) => apiRequest(z.object({ logged_out: z.boolean() }), mobilePath(store) + "/logout", post());
export const startStaffLogin = (store: string, invite?: string) => apiRequest(z.object({ authorize_url: z.string().url() }), "/auth/kakao/start", post({ store_id: store, invite_token: invite }));
export const fetchAttendanceQR = (store: string) => apiRequest(z.object({ svg: z.string(), server_now: z.string(), expires_at: z.string(), provisional: z.boolean() }), ownerPath(store) + "/qr", post());
export const fetchQRStatus = (store: string, since: string, staff?: string) => apiRequest(z.object({ completed: recordedSchema.nullable(), provisional: z.boolean() }), ownerPath(store) + `/qr-status?${new URLSearchParams({ since, ...(staff ? { staff_id: staff } : {}) })}`);
export const fetchStaffIdentities = (store: string) => apiRequest(z.array(z.object({ staff_id: z.string().uuid(), name: z.string(), nickname: z.string().nullable(), status: z.enum(["UNLINKED", "PENDING", "ACTIVE"]), provisional: z.boolean() })), ownerPath(store) + "/identities");
export const inviteStaff = (store: string, staff: string) => apiRequest(z.object({ url: z.string().url(), expires_at: z.string(), provisional: z.boolean() }), ownerPath(store) + `/staff/${staff}/invite`, post());
export const approveStaff = (store: string, staff: string) => apiRequest(z.object({ approved: z.boolean(), provisional: z.boolean() }), ownerPath(store) + `/staff/${staff}/approve`, post());
