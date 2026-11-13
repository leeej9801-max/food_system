import { describe, expect, it } from "vitest";

import type { StoreTable } from "../types";
import { canPlace } from "./FloorPlan";

const t = (id: string) => ({ id }) as StoreTable;
const box = (id: string, x: number, y: number) => ({
  table: t(id),
  x,
  y,
  w: 4,
  h: 2,
});

describe("canPlace", () => {
  const others = [box("a", 0, 0), box("b", 10, 0)];
  const wall = [{ kind: "PARTITION", x: 0, y: 10, w: 28, h: 1 }];

  it("빈 자리와 맞닿은 자리는 놓을 수 있다", () => {
    expect(canPlace(others, wall as never, box("b", 4, 0))).toBe(true);
    expect(canPlace(others, wall as never, box("b", 5, 5))).toBe(true);
  });

  it("다른 테이블이나 고정물과 겹치면 놓을 수 없다", () => {
    expect(canPlace(others, wall as never, box("b", 3, 1))).toBe(false);
    expect(canPlace(others, wall as never, box("b", 5, 9))).toBe(false);
  });
});
