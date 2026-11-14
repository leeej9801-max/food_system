import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLink as Link } from "../components/AppLink";
import { HeroKpi } from "../components/HeroKpi";
import { fetchSalesAnalytics, simulateMenuCosts } from "../api/analytics";
import type { Store } from "../types";

interface AnalyticsPageProps {
  store: Store;
}

const won = (v: string | number) => Math.round(Number(v)).toLocaleString("ko-KR");
const signed = (p: number) => (p > 0 ? `+${p}%` : `${p}%`);
const TOP_N = 5;

// 시안 A 대시보드 배치 (U-52): 제목 줄 → 지표 3칸 → 시간대 차트·메뉴 순위 → 원가 시뮬레이션
export function AnalyticsPage({ store }: AnalyticsPageProps) {
  const [globalChangePercent, setGlobalChangePercent] = useState<number>(0);
  const [ingredientChanges, setIngredientChanges] = useState<Record<string, number>>({});
  const [expandedMenuId, setExpandedMenuId] = useState<string | null>(null);
  const [showAllMenus, setShowAllMenus] = useState(false);

  const salesQuery = useQuery({
    queryKey: ["analytics-sales", store.id],
    queryFn: () => fetchSalesAnalytics(store.id),
  });

  const costingQuery = useQuery({
    queryKey: ["analytics-costing", store.id, globalChangePercent, ingredientChanges],
    queryFn: () =>
      simulateMenuCosts(store.id, {
        global_change_percent: globalChangePercent,
        ingredient_change_percents: ingredientChanges,
      }),
  });

  const sales = salesQuery.data;
  const costing = costingQuery.data;
  const menus = costing?.menus ?? [];
  const highCostCount = menus.filter((m) => m.high_cost_warning).length;
  const customIngredientCount = Object.keys(ingredientChanges).length;
  const avgTicket =
    sales && sales.total_completed_orders > 0
      ? Math.round(Number(sales.total_net_sales) / sales.total_completed_orders)
      : null;

  const hours = (sales?.hourly_buckets ?? []).filter(
    (b) => b.quantity > 0 || (b.hour >= 11 && b.hour <= 21)
  );
  const maxHourQty = Math.max(1, ...hours.map((b) => b.quantity));
  const peak = hours.reduce<(typeof hours)[number] | null>(
    (best, b) => (b.quantity > 0 && (!best || b.quantity > best.quantity) ? b : best),
    null
  );

  const rankings = sales?.menu_rankings ?? [];
  const maxMenuQty = Math.max(1, ...rankings.map((r) => r.quantity));
  const shownRankings = showAllMenus ? rankings : rankings.slice(0, TOP_N);

  return (
    <div>
      <div className="page-heading">
        <div className="page-title">
          <h1>분석</h1>
          <span className="title-divider" />
          <span className="title-meta">누적</span>
        </div>
        <div className="page-actions">
          <Link to="/inventory" className="pill pill-secondary">
            입고 단가 등록
          </Link>
          <Link to="/settings" className="pill pill-primary">
            판매 CSV 업로드
          </Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-[1.12fr_1fr_1.32fr] xl:mb-5 xl:gap-5">
        <HeroKpi label="누적 순매출" value={won(sales?.total_net_sales ?? 0)} unit="원">
          완료 주문 {sales?.total_completed_orders ?? 0}건
        </HeroKpi>

        <section className="card flex flex-col justify-between">
          <div className="kpi-label">누적 판매 수량</div>
          <div className="kpi-value">
            {won(sales?.total_quantity ?? 0)}
            <small>개</small>
          </div>
          <div className="kpi-sub">시각 미상 {sales?.unknown_hour_quantity ?? 0}개</div>
        </section>

        <section className="card grid grid-cols-2 gap-4 !bg-accent-50 sm:col-span-2 md:col-span-1">
          <div className="flex min-w-0 flex-col justify-between">
            <div className="kpi-label">객단가</div>
            <div className="kpi-value">
              {avgTicket === null ? "-" : won(avgTicket)}
              {avgTicket !== null && <small>원</small>}
            </div>
            <div className="kpi-sub">완료 주문 기준</div>
          </div>
          <div className="flex min-w-0 flex-col justify-between">
            <div className="kpi-label">고원가율 메뉴</div>
            <div className={`kpi-value ${highCostCount > 0 ? "!text-[#965d11]" : ""}`}>
              {highCostCount}
              <small>개</small>
            </div>
            <div className="kpi-sub">원가율 35% 이상</div>
          </div>
        </section>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-12 xl:mb-5 xl:gap-5">
        <section className="card md:col-span-7">
          <div className="card-head">
            <h2>시간대별 판매</h2>
            {peak && (
              <span className="card-meta">
                가장 많은 시간 {peak.hour}시 · {peak.quantity}개
              </span>
            )}
          </div>
          {(sales?.known_hour_quantity ?? 0) === 0 ? (
            <p className="py-12 text-center text-sm text-muted">시각이 있는 판매 기록이 없습니다</p>
          ) : (
            <div className="flex h-[232px] items-end gap-1.5 sm:gap-2.5" role="list">
              {hours.map((b) => {
                const h = Math.max(2, Math.round((b.quantity / maxHourQty) * 100));
                const isPeak = peak?.hour === b.hour;
                return (
                  <div
                    key={b.hour}
                    role="listitem"
                    aria-label={`${b.hour}시 ${b.quantity}개 ${won(b.sales_amount)}원`}
                    title={`${b.quantity}개 · ${won(b.sales_amount)}원`}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                  >
                    <span
                      className={`text-[11px] tabular-nums ${isPeak ? "font-semibold text-ink" : "text-muted"}`}
                    >
                      {b.quantity > 0 ? b.quantity : ""}
                    </span>
                    <div className="flex w-full flex-1 items-end overflow-hidden rounded-[10px] bg-ground">
                      <div
                        className={`w-full rounded-[10px] transition-[height] ${isPeak ? "bg-accent-600" : "bg-accent-300"}`}
                        style={{ height: `${h}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-muted tabular-nums">{b.hour}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card md:col-span-5">
          <div className="card-head">
            <h2>메뉴별 판매 TOP {TOP_N}</h2>
            {rankings.length > TOP_N && (
              <button
                type="button"
                onClick={() => setShowAllMenus((v) => !v)}
                className="text-xs text-muted hover:text-ink"
              >
                {showAllMenus ? "접기" : `전체 ${rankings.length}개`}
              </button>
            )}
          </div>
          {rankings.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">판매 기록이 없습니다</p>
          ) : (
            <ol className="flex flex-col gap-5">
              {shownRankings.map((r, idx) => (
                <li
                  key={`${r.menu_name}-${idx}`}
                  className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5"
                >
                  <span className="text-xs text-muted tabular-nums">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-[550] text-ink">{r.menu_name}</span>
                    {r.mapping_status !== "MAPPED" && <span className="chip chip-warn">미연결</span>}
                  </span>
                  <span className="row-span-2 text-[15px] font-semibold text-ink tabular-nums">
                    {r.quantity}
                    <small className="ml-0.5 text-[11px] font-normal text-muted">개</small>
                  </span>
                  <span className="col-start-2 h-[5px] overflow-hidden rounded-full bg-ground">
                    <span
                      className={`block h-full rounded-full ${idx === 0 ? "bg-ink" : "bg-accent-300"}`}
                      style={{ width: `${Math.round((r.quantity / maxMenuQty) * 100)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head flex-wrap">
          <div className="flex items-baseline gap-3">
            <h2>메뉴 원가 시뮬레이션</h2>
            <span className="card-meta">최근 입고 단가 기준</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="전체 단가 변동률">
            {[-5, 0, 5, 10, 20].map((pct) => (
              <button
                key={pct}
                type="button"
                aria-pressed={globalChangePercent === pct}
                onClick={() => setGlobalChangePercent(pct)}
                className="pill pill-sm pill-soft tabular-nums"
              >
                {pct === 0 ? "현재" : signed(pct)}
              </button>
            ))}
            {customIngredientCount > 0 && (
              <button
                type="button"
                onClick={() => setIngredientChanges({})}
                className="pill pill-sm pill-soft"
              >
                개별 {customIngredientCount}건 초기화
              </button>
            )}
          </div>
        </div>

        {menus.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">활성 메뉴가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>메뉴</th>
                  <th className="!text-right">판매가</th>
                  <th className="!text-right">원가</th>
                  <th className="!text-right">원가율</th>
                  <th className="!text-right">
                    변동 후 원가{globalChangePercent !== 0 && ` (${signed(globalChangePercent)})`}
                  </th>
                  <th className="!text-right">변동 후 마진</th>
                  <th>상태</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {menus.map((m) => {
                  const isExpanded = expandedMenuId === m.menu_item_id;
                  const delta = Number(m.cost_delta);
                  return (
                    <Fragment key={m.menu_item_id}>
                      <tr>
                        <td>
                          <span className="font-semibold">{m.menu_name}</span>
                          {m.category && <span className="ml-2 text-xs text-muted">{m.category}</span>}
                        </td>
                        <td className="text-right tabular-nums">
                          {m.selling_price !== null ? `${won(m.selling_price)}원` : "-"}
                        </td>
                        <td className="text-right tabular-nums">{won(m.base_recipe_cost)}원</td>
                        <td className="text-right tabular-nums">
                          {m.base_cost_ratio_percent !== null ? `${m.base_cost_ratio_percent}%` : "-"}
                        </td>
                        <td className="text-right font-semibold tabular-nums">
                          {won(m.simulated_recipe_cost)}원
                          {delta !== 0 && (
                            <span className={`ml-1 text-xs ${delta > 0 ? "text-red-600" : "text-accent-700"}`}>
                              {delta > 0 ? "+" : ""}
                              {won(delta)}
                            </span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">
                          {m.simulated_margin !== null ? (
                            <>
                              {won(m.simulated_margin)}원
                              {m.simulated_cost_ratio_percent !== null && (
                                <span className={`chip ml-2 ${m.high_cost_warning ? "chip-warn" : "chip-ok"}`}>
                                  {m.simulated_cost_ratio_percent}%
                                </span>
                              )}
                            </>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>
                          {m.cost_status === "COMPLETE" ? (
                            <span className="chip chip-ok">계산 완료</span>
                          ) : m.cost_status === "NO_RECIPE" ? (
                            <span className="chip chip-idle">레시피 없음</span>
                          ) : (
                            <span
                              className="chip chip-warn"
                              title={`단가 없음: ${m.missing_cost_ingredients.join(", ")}`}
                            >
                              단가 {m.missing_cost_ingredients.length}종 없음
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          {m.breakdown.length > 0 && (
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-label={`${m.menu_name} 식자재별 원가`}
                              onClick={() => setExpandedMenuId(isExpanded ? null : m.menu_item_id)}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-ground hover:text-ink"
                            >
                              <svg
                                aria-hidden
                                viewBox="0 0 24 24"
                                className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M6 9l6 6 6-6" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} className="!h-auto !whitespace-normal bg-ground/60 !px-4 py-3">
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {m.breakdown.map((b) => {
                                const customVal = ingredientChanges[b.ingredient_id] ?? globalChangePercent;
                                return (
                                  <div
                                    key={b.ingredient_id}
                                    className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2.5"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-[13px] font-semibold">
                                        {b.ingredient_name}
                                        <span className="ml-1.5 text-xs font-normal text-muted">
                                          {Number(b.quantity)}
                                          {b.base_unit}
                                        </span>
                                      </div>
                                      <div className="truncate text-xs text-muted tabular-nums">
                                        {b.base_line_cost !== null && b.simulated_line_cost !== null
                                          ? `${won(b.base_line_cost)}원 → ${won(b.simulated_line_cost)}원`
                                          : "단가 없음"}
                                      </div>
                                    </div>
                                    <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
                                      <input
                                        aria-label={`${b.ingredient_name} 변동률(%)`}
                                        type="number"
                                        step="1"
                                        min="-90"
                                        max="500"
                                        value={customVal}
                                        onChange={(e) => {
                                          const val = Number(e.target.value);
                                          setIngredientChanges((prev) => ({
                                            ...prev,
                                            [b.ingredient_id]: Number.isFinite(val) ? val : 0,
                                          }));
                                        }}
                                        className="h-9 w-16 rounded-lg bg-ground px-2 text-right text-[13px] text-ink tabular-nums"
                                      />
                                      %
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
