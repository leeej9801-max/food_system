import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStaffMe, recordStaffQR } from "./staffAccess";

afterEach(() => vi.unstubAllGlobals());
const store = "ce6af1d9-5ebf-4b39-84da-119b28620568";
const staff = "5ed7935c-c907-43e3-9d75-b41325d7b326";
const key = "80a1236c-41d3-4278-a998-31e7ec8b582d";
const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

describe("staff cookie boundary", () => {
  it("uses credentials and keeps the event UUID when refreshing a failed record", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(ok({ refreshed: true }))
      .mockResolvedValueOnce(ok({ event_id: key, name: "QA", kind: "IN", occurred_at: new Date().toISOString() }));
    vi.stubGlobal("fetch", fetcher);
    const qr = crypto.randomUUID();
    await recordStaffQR(store, qr, key);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map((c) => c[1].credentials)).toEqual(["include", "include", "include"]);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[2][1].body);
    expect(JSON.parse(fetcher.mock.calls[2][1].body).client_event_id).toBe(key);
  });

  it("shares a rotation for concurrent 401 responses", async () => {
    let count = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/refresh")) { await new Promise((r) => setTimeout(r, 5)); return ok({ refreshed: true }); }
      if (++count <= 2) return new Response("{}", { status: 401 });
      return ok({ staff_id: staff, name: "QA", status: "ACTIVE" });
    });
    vi.stubGlobal("fetch", fetcher);
    await Promise.all([fetchStaffMe(store), fetchStaffMe(store)]);
    expect(fetcher.mock.calls.filter((c) => c[0].endsWith("/refresh"))).toHaveLength(1);
  });
});
