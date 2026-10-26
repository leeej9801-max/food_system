import { describe, expect, it } from "vitest";
import { formatKrwPrice, validateMenuForm } from "./menuValidation";

describe("validateMenuForm", () => {
  it("requires non-empty menu name", () => {
    const res = validateMenuForm({
      name: "   ",
      sellingPrice: "12000",
      category: "식사",
      description: "",
      isActive: true,
    });
    expect(res.valid).toBe(false);
    expect(res.errors.name).toBeDefined();
  });

  it("rejects negative selling price", () => {
    const res = validateMenuForm({
      name: "제육볶음",
      sellingPrice: "-100",
      category: "",
      description: "",
      isActive: true,
    });
    expect(res.valid).toBe(false);
    expect(res.errors.selling_price).toBeDefined();
  });

  it("normalizes optional empty fields to null", () => {
    const res = validateMenuForm({
      name: "  김치찌개  ",
      sellingPrice: "",
      category: "   ",
      description: "",
      isActive: true,
    });
    expect(res.valid).toBe(true);
    expect(res.normalizedPayload).toEqual({
      name: "김치찌개",
      selling_price: null,
      category: null,
      description: null,
      is_active: true,
    });
  });
});

describe("formatKrwPrice", () => {
  it("formats number with comma and 원", () => {
    expect(formatKrwPrice("12000.00")).toBe("12,000원");
  });

  it("returns 미입력 for null", () => {
    expect(formatKrwPrice(null)).toBe("미입력");
  });
});
