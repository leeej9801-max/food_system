import type { CSSProperties, ReactNode } from "react";

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  variant?: "rect" | "text" | "circle" | "pill";
  tone?: "default" | "on-accent";
  className?: string;
  style?: CSSProperties;
}

function toSize(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * 앱 전역에서 재사용하는 단일 스켈레톤 플레이스홀더.
 * prefers-reduced-motion: reduce 환경에서는 쉬머 애니메이션을 끈다.
 */
export function Skeleton({
  width,
  height,
  radius,
  variant = "rect",
  tone = "default",
  className = "",
  style,
}: SkeletonProps) {
  const inlineStyle: CSSProperties = {
    ...(width !== undefined ? { width: toSize(width) } : {}),
    ...(height !== undefined ? { height: toSize(height) } : {}),
    ...(radius !== undefined ? { borderRadius: toSize(radius) } : {}),
    ...style,
  };
  return (
    <span
      aria-hidden="true"
      data-skeleton="true"
      className={`sk sk-${variant}${tone === "on-accent" ? " sk-on-accent" : ""}${className ? ` ${className}` : ""}`}
      style={inlineStyle}
    />
  );
}

export interface SkeletonTableColumn {
  label?: ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  headerClassName?: string;
}

const CELL_WIDTHS = ["72%", "58%", "84%", "64%", "50%", "78%"];

export function SkeletonTable({
  columns,
  rows = 6,
  tableClassName = "data-table",
  ariaLabel = "표 불러오는 중",
}: {
  columns: SkeletonTableColumn[];
  rows?: number;
  tableClassName?: string;
  ariaLabel?: string;
}) {
  const alignClass = (align?: "left" | "right" | "center") => {
    if (tableClassName.includes("kpi-table")) {
      return align === "right" ? "n" : align === "center" ? "c" : undefined;
    }
    return align === "right" ? "!text-right" : align === "center" ? "!text-center" : undefined;
  };

  return (
    <div className="sk-table-wrap" role="status" aria-busy="true" aria-label={ariaLabel}>
      <table className={tableClassName}>
        <thead>
          <tr>
            {columns.map((col, idx) => (
              <th
                key={idx}
                className={col.headerClassName ?? alignClass(col.align)}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label ?? <Skeleton width="56%" height={12} variant="text" />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, rowIdx) => (
            <tr key={rowIdx}>
              {columns.map((col, colIdx) => {
                const cellAlign = alignClass(col.align);
                const barWidth = CELL_WIDTHS[(rowIdx + colIdx) % CELL_WIDTHS.length];
                return (
                  <td key={colIdx} className={cellAlign}>
                    <Skeleton
                      width={barWidth}
                      height={14}
                      variant="text"
                      className={
                        col.align === "right"
                          ? "sk-align-right"
                          : col.align === "center"
                            ? "sk-align-center"
                            : ""
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DEFAULT_BAR_HEIGHTS = [38, 62, 48, 84, 70, 56, 92, 64, 44, 76, 52];

export function SkeletonBarChart({
  bars = 6,
  height = 180,
  className = "",
  ariaLabel = "차트 불러오는 중",
}: {
  bars?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      className={`sk-barchart${className ? ` ${className}` : ""}`}
      style={{ height: `${height}px` }}
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
    >
      {Array.from({ length: bars }, (_, idx) => {
        const pct = DEFAULT_BAR_HEIGHTS[idx % DEFAULT_BAR_HEIGHTS.length];
        return (
          <div key={idx} className="sk-barchart-col">
            <Skeleton width="100%" height={`${pct}%`} radius="8px 8px 4px 4px" />
            <Skeleton width={28} height={10} variant="text" />
          </div>
        );
      })}
    </div>
  );
}

/**
 * 메뉴·식자재 관리 화면(lazy 청크 로딩 등)에서 쓰는 3-KPI + 표 스켈레톤.
 */
export function KpiPageSkeleton({ ariaLabel = "화면 불러오는 중" }: { ariaLabel?: string }) {
  return (
    <div className="kpi-page" role="status" aria-busy="true" aria-label={ariaLabel}>
      <div className="kpi-title">
        <Skeleton width={120} height={26} />
        <Skeleton width={150} height={16} />
      </div>
      <section className="kpi-grid">
        <article className="kpi-card">
          <div className="kpi-head">
            <Skeleton width={96} height={16} />
            <Skeleton width={110} height={14} />
          </div>
          <Skeleton width={140} height={36} />
          <Skeleton width="100%" height={12} radius={6} />
          <div className="kpi-rows">
            {[0, 1, 2].map((i) => (
              <div key={i} className="kpi-row">
                <Skeleton width={110} height={14} />
                <Skeleton width={72} height={14} />
              </div>
            ))}
          </div>
        </article>
        <article className="kpi-card">
          <div className="kpi-head">
            <Skeleton width={76} height={16} />
            <Skeleton width={96} height={14} />
          </div>
          <Skeleton width="100%" height={28} radius={6} />
          <div className="kpi-rows">
            {[0, 1, 2].map((i) => (
              <div key={i} className="kpi-row">
                <Skeleton width={88} height={14} />
                <Skeleton width={48} height={14} />
              </div>
            ))}
          </div>
        </article>
        <article className="kpi-card">
          <div className="kpi-head">
            <Skeleton width={76} height={16} />
            <Skeleton width={40} height={14} />
          </div>
          <div className="kpi-rows">
            {[0, 1, 2].map((i) => (
              <div key={i} className="kpi-row">
                <Skeleton width={104} height={14} />
                <Skeleton width={44} height={14} />
              </div>
            ))}
          </div>
        </article>
      </section>
      <section className="kpi-table-section">
        <div className="kpi-bar">
          <Skeleton width={280} height={34} variant="pill" />
          <div className="kpi-right">
            <Skeleton width={200} height={34} variant="pill" />
            <Skeleton width={104} height={34} variant="pill" />
          </div>
        </div>
        <SkeletonTable
          tableClassName="kpi-table"
          columns={[
            { width: "14%" },
            { width: "22%" },
            { align: "right", width: "12%" },
            { align: "right", width: "12%" },
            { align: "right", width: "12%" },
            { align: "center", width: "14%" },
            { align: "center", width: "14%" },
          ]}
          rows={7}
          ariaLabel={ariaLabel}
        />
      </section>
    </div>
  );
}

/**
 * 최초 앱 진입 시 매장 목록 조회 중 보여 주는 셸 스켈레톤.
 */
export function ShellPageSkeleton() {
  return (
    <div
      className="min-h-[var(--app-viewport-height)] bg-ground"
      role="status"
      aria-busy="true"
      aria-label="매장 정보 불러오는 중"
    >
      <header className="flex min-h-[68px] items-center bg-ground px-4 py-3 md:px-6 xl:px-8">
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Skeleton width={44} height={44} variant="circle" />
            <Skeleton width={140} height={20} />
            <Skeleton width={160} height={14} className="hidden sm:inline-block" />
          </div>
          <div className="flex items-center gap-5">
            <Skeleton width={96} height={16} />
            <Skeleton width={88} height={16} />
            <Skeleton width={88} height={16} />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1800px] px-4 pt-3 pb-9 md:px-6 xl:px-8">
        <KpiPageSkeleton ariaLabel="매장 정보 불러오는 중" />
      </div>
    </div>
  );
}
