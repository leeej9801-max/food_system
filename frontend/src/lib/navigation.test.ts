import { describe, expect, it } from "vitest";
import { readQueryValue, withStore } from "./navigation";

describe("shared store navigation", () => {
  it("keeps the store and destination filters without leaking source filters", () => {
    expect(withStore("/inventory?tab=COUNT#form", "?store=abc&q=menu"))
      .toBe("/inventory?tab=COUNT&store=abc#form");
    expect(withStore("/home?store=other", "?store=abc")).toBe("/home?store=other");
    expect(withStore("/home", "")).toBe("/home");
  });
  it("reads encoded filters and rejects invalid enum values", () => {
    expect(readQueryValue("?q=%ED%8C%8C%EC%8A%A4%ED%83%80", "q", "")).toBe("파스타");
    expect(readQueryValue("?status=oops", "status", "all", ["all", "active"])).toBe("all");
  });
});
