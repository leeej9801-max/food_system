import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { simulateMenuCosts } from "../api/analytics";
import type { Store } from "../types";

interface LabPageProps {
  store: Store;
}

const won = (v: string | number) => Math.round(Number(v)).toLocaleString("ko-KR");
const signed = (p: number) => (p > 0 ? `+${p}%` : `${p}%`);

// 실험실: 정식 화면 전 부가 분석·기능을 모으는 곳. 메뉴 원가 시뮬레이션을 분석에서 옮겨 옴
export function LabPage({ store }: LabPageProps) {
  const [globalChangePercent, setGlobalChangePercent] = useState<number>(0);
  const [ingredientChanges, setIngredientChanges] = useState<Record<string, number>>({});
  const [expandedMenuId, setExpandedMenuId] = useState<string | null>(null);

  const costingQuery = useQuery({
    queryKey: ["analytics-costing", store.id, globalChangePercent, ingredientChanges],
    queryFn: () =>
      simulateMenuCosts(store.id, {
        global_change_percent: globalChangePercent,
        ingredient_change_percents: ingredientChanges,
      }),
  });

  const costing = costingQuery.data;
  const menus = costing?.menus ?? [];
  const customIngredientCount = Object.keys(ingredientChanges).length;

  return (
    <div className="lab-page">
      <div className="page-heading">
        <div className="page-title">
          <h1>실험실</h1>
          <span className="title-divider" />
          <span className="title-meta">베타</span>
        </div>
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
