import type { ReactNode } from "react";

// 화면마다 가장 중요한 지표 하나를 진한 카드로 강조한다 (U-51).
export function HeroKpi({
  label,
  value,
  unit,
  tone = "normal",
  children,
  className = "",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "normal" | "alert";
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={`flex flex-col gap-3 rounded-[26px] bg-ink p-6 text-white ${className}`}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-accent-300">
        {tone === "alert" && <span aria-hidden className="h-2 w-2 rounded-full bg-amber-400" />}
        {label}
      </div>
      <div className="text-[28px] leading-none font-bold tabular-nums">
        {value}
        {unit && <span className="ml-1 text-sm font-semibold">{unit}</span>}
      </div>
      {children && <div className="text-sm text-white/75">{children}</div>}
    </section>
  );
}
