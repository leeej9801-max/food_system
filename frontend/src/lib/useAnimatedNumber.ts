import { useEffect, useRef, useState } from "react";

export function easeOutCubic(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return 1 - (1 - clamped) ** 3;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  if (typeof window.requestAnimationFrame !== "function") return true;
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * KPI 숫자 등이 바뀔 때 목표값까지 부드럽게 카운트 업/다운한다 (기본 900ms ease-out, 느린 네트워크 뒤 늦게 떠도 차분하게).
 * SSR 및 `prefers-reduced-motion: reduce` 환경에서는 즉시 목표값을 반환한다.
 */
export function useAnimatedNumber(target: number | null, durationMs = 900): number | null {
  const reduced = prefersReducedMotion();
  const initialValue = !reduced && target !== null ? 0 : target;
  const [shown, setShown] = useState<number | null>(initialValue);
  const shownRef = useRef<number | null>(initialValue);

  useEffect(() => {
    if (reduced || target === null || !Number.isFinite(target)) {
      shownRef.current = target;
      if (!reduced && target === null) {
        const rafReset = window.requestAnimationFrame(() => {
          setShown(null);
        });
        return () => window.cancelAnimationFrame(rafReset);
      }
      return;
    }

    const from = shownRef.current ?? 0;
    if (from === target || durationMs <= 0) {
      shownRef.current = target;
      const rafImmediate = window.requestAnimationFrame(() => {
        setShown(target);
      });
      return () => window.cancelAnimationFrame(rafImmediate);
    }

    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const next = progress >= 1 ? target : from + (target - from) * easeOutCubic(progress);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) {
        raf = window.requestAnimationFrame(tick);
      }
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [target, durationMs, reduced]);

  if (reduced || target === null || !Number.isFinite(target)) {
    return target;
  }
  return shown ?? target;
}
