import { afterEach, expect, it, vi } from "vitest";
import { clearStaffLink, readStaffLink } from "./staffLink";

afterEach(() => vi.unstubAllGlobals());
const store = "ce6af1d9-5ebf-4b39-84da-119b28620568";
function setup(hash: string, stored: string | null = null) {
  let storage = stored;
  vi.stubGlobal("location", { hash, pathname: "/staff/attendance", search: "" });
  const replace = vi.fn();
  vi.stubGlobal("history", { replaceState: replace });
  vi.stubGlobal("sessionStorage", { getItem: () => storage, setItem: (_: string, value: string) => { storage = value; }, removeItem: () => { storage = null; } });
  return { replace, stored: () => storage };
}
it("removes the QR fragment from browser history and keeps one retry UUID", () => {
  const qr = crypto.randomUUID();
  const state = setup(`#store=${store}&qr=${qr}`);
  const context = readStaffLink();
  expect(context?.qr).toBe(qr);
  expect(state.replace).toHaveBeenCalledWith(null, "", "/staff/attendance");
  vi.stubGlobal("location", { hash: "", search: "", pathname: "/staff/attendance" });
  expect(readStaffLink()?.clientEvent).toBe(context?.clientEvent);
  clearStaffLink(); expect(state.stored()).toBeNull();
});
it("discards corrupt and stale storage", () => {
  setup("", "{invalid"); expect(readStaffLink()).toBeNull();
  setup("", JSON.stringify({ store, clientEvent: crypto.randomUUID(), created: Date.now() - 601_000 }));
  expect(readStaffLink()).toBeNull();
});
