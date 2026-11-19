import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { easeOutCubic, prefersReducedMotion, useAnimatedNumber } from "./useAnimatedNumber";

function Probe({ target }: { target: number | null }) {
  const value = useAnimatedNumber(target);
  return <span>{value === null ? "null" : String(value)}</span>;
}

describe("useAnimatedNumber", () => {
  it("easeOutCubic은 0~1 경계를 지키며 감속 곡선을 따른다", () => {
    expect(easeOutCubic(-0.5)).toBe(0);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 5);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("SSR(window 없음) 환경에서는 reduced-motion으로 간주해 목표값을 즉시 반환한다", () => {
    expect(prefersReducedMotion()).toBe(true);
    expect(renderToStaticMarkup(<Probe target={1234.5} />)).toBe("<span>1234.5</span>");
    expect(renderToStaticMarkup(<Probe target={null} />)).toBe("<span>null</span>");
  });
});
