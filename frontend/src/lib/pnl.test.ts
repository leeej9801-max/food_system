import { describe, expect, it } from "vitest";
import { achievement, averageOrderValue, businessDayProgress, changeRate, kpiDelta, shiftMonth } from "./pnl";

describe("손익 계산 도우미", () => {
  it("증감률은 기준 0이면 숨기고, 음수 기준은 절댓값으로 나눈다", () => {
    expect(changeRate(110, 100)).toBe("▲ 10.0%");
    expect(changeRate(50, 100)).toBe("▼ 50.0%");
    expect(changeRate(100, 0)).toBeUndefined();
    expect(changeRate(-50, -100)).toBe("▲ 50.0%");
  });

  it("달성률은 목표가 없거나 0 이하면 null", () => {
    expect(achievement(720, 1000)).toBe(72);
    expect(achievement(720, null)).toBeNull();
    expect(achievement(720, 0)).toBeNull();
  });

  it("월 이동은 연도를 넘긴다", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("KPI는 작은 비교 기준, 0과 부호 전환에서 금액을 쓴다", () => {
    expect(kpiDelta(110, 100).text).toBe("▲ 10.0%");
    expect(kpiDelta(1000, 99).text).toBe("▲ 901원");
    expect(kpiDelta(1000, 100).text).toBe("▲ 900.0%");
    expect(kpiDelta(100, -100).text).toBe("▲ 200원");
    expect(kpiDelta(-100, 100).text).toBe("▼ 200원");
    expect(kpiDelta(-50, -100).text).toBe("▲ 50.0%");
    expect(kpiDelta(100, 0).text).toBe("▲ 100원");
    expect(kpiDelta(0, 100).text).toBe("▼ 100.0%");
    expect(kpiDelta(0, 0).text).toBe("− 0원");
    expect(kpiDelta(100, null).text).toBe("미산출");
    expect(kpiDelta(null, 100).text).toBe("미산출");
    expect(kpiDelta(110, 100, true).text).toBe("▲ 10원");
  });

  it("객단가는 주문 수 기준, 0건이면 미산출", () => {
    expect(averageOrderValue(40001, 2)).toBe(20001);
    expect(averageOrderValue(40000, 0)).toBeNull();
  });

  it("영업일 진도는 오늘까지 경과, 이후 잔여일과 윤달·과거·미래를 처리한다", () => {
    expect(businessDayProgress("2026-11", "월,화,수,목,금", "2026-11-17")).toEqual({ total: 21, elapsed: 12, remaining: 9, expected: 12 / 21 * 100 });
    expect(businessDayProgress("2024-02", "목", "2024-02-29")?.total).toBe(5);
    expect(businessDayProgress("2026-10", "일", "2026-11-17")?.remaining).toBe(0);
    expect(businessDayProgress("2026-12", "일", "2026-11-17")?.elapsed).toBe(0);
    expect(businessDayProgress("2026-11", null, "2026-11-17")).toBeNull();
  });
});
