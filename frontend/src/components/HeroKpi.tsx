import type { ReactNode } from "react";

// 화면마다 가장 중요한 지표 하나를 강조색 카드로 보인다 (U-51). 글씨는 줄바꿈하지 않는다.
export function HeroKpi({
  label,
  value,
  unit,
  tone = "normal",
  delta,
  children,
  className = "",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "normal" | "alert";
  delta?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={`flex min-w-0 flex-col rounded-2xl bg-accent-600 px-6 py-5 text-white ${className}`}
    >
      <div className="flex items-center gap-2 truncate text-[15px] text-white/80">
        {tone === "alert" && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-300" />}
        {label}
      </div>
      <div className="mt-3 truncate text-[30px] leading-tight font-semibold tracking-[-1.1px] tabular-nums">
        {value}
        {unit && <span className="ml-1.5 text-sm font-normal tracking-normal">{unit}</span>}
      </div>
      {(delta || children) && (
        <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-white/80">
          {delta && (
            <span className="shrink-0 rounded-md bg-white/20 px-1.5 py-0.5 font-semibold text-white tabular-nums">
              {delta}
            </span>
          )}
          {children && <span className="truncate">{children}</span>}
        </div>
      )}
    </section>
  );
}
