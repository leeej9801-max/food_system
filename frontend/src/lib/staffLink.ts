import { z } from "zod";

const contextSchema = z.object({ store: z.string().uuid(), qr: z.string().optional(), invite: z.string().optional(), clientEvent: z.string().uuid(), created: z.number() });
export type StaffLinkContext = z.infer<typeof contextSchema>;
const key = "food_staff_link";

export function readStaffLink(): StaffLinkContext | null {
  const hash = new URLSearchParams(location.hash.slice(1));
  const store = hash.get("store");
  if (store) {
    const context = contextSchema.safeParse({ store, qr: hash.get("qr") ?? undefined, invite: hash.get("invite") ?? undefined, clientEvent: crypto.randomUUID(), created: Date.now() });
    history.replaceState(null, "", location.pathname + location.search);
    if (!context.success) return null;
    sessionStorage.setItem(key, JSON.stringify(context.data));
    return context.data;
  }
  let raw: unknown = null;
  try { raw = JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { sessionStorage.removeItem(key); }
  const stored = contextSchema.safeParse(raw);
  const queryStore = new URLSearchParams(location.search).get("store");
  if (stored.success && (!queryStore || queryStore === stored.data.store) && Date.now() - stored.data.created < 10 * 60_000) return stored.data;
  sessionStorage.removeItem(key);
  return queryStore && z.string().uuid().safeParse(queryStore).success
    ? { store: queryStore, clientEvent: crypto.randomUUID(), created: Date.now() } : null;
}

export function clearStaffLink() { sessionStorage.removeItem(key); }
