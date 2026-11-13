import { describe, expect, it } from "vitest";
import type { z } from "zod";
import samples from "./__fixtures__/responses.json";
import * as schemas from "./schemas";

// 표본은 실제 백엔드 응답이다. 갱신: backend/tests/api/test_frontend_samples.py 머리말 참고
const byName = schemas as Record<string, z.ZodType>;

describe("응답 스키마가 실제 백엔드 응답과 맞는다", () => {
  it("모든 스키마에 표본이 있다", () => {
    expect(Object.keys(samples).sort()).toEqual(Object.keys(schemas).sort());
  });

  it.each(Object.entries(samples))("%s", (name, rows) => {
    for (const row of rows) {
      const result = byName[name]!.safeParse(row);
      expect(result.success ? [] : result.error.issues).toEqual([]);
    }
  });

  it("모양이 다른 응답은 거부한다", () => {
    expect(schemas.storeSchema.safeParse({ id: 1 }).success).toBe(false);
  });
});
