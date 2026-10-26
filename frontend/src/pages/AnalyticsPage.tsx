import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchSalesAnalytics, simulateMenuCosts } from "../api/analytics";
import type { Store } from "../types";

interface AnalyticsPageProps {
  store: Store;
}

export function AnalyticsPage({ store }: AnalyticsPageProps) {
  const [globalChangePercent, setGlobalChangePercent] = useState<number>(0);
  const [ingredientChanges, setIngredientChanges] = useState<
    Record<string, number>
  >({});
  const [expandedMenuId, setExpandedMenuId] = useState<string | null>(null);

  const salesQuery = useQuery({
    queryKey: ["analytics-sales", store.id],
    queryFn: () => fetchSalesAnalytics(store.id),
  });

  const costingQuery = useQuery({
    queryKey: [
      "analytics-costing",
      store.id,
      globalChangePercent,
      ingredientChanges,
    ],
    queryFn: () =>
      simulateMenuCosts(store.id, {
        global_change_percent: globalChangePercent,
        ingredient_change_percents: ingredientChanges,
      }),
  });

  const sales = salesQuery.data;
  const costing = costingQuery.data;
  const highCostCount = (costing?.menus ?? []).filter((m) => m.high_cost_warning).length;
  const maxHourQty = Math.max(
    1,
    ...(sales?.hourly_buckets.map((b) => b.quantity) ?? [1])
  );
  const customIngredientCount = Object.keys(ingredientChanges).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">분석</h1>
          <p className="text-sm text-gray-600">
            메뉴별 원가·원가율, 단가 변동 시나리오, 시간대별·메뉴별 판매량. 원가는 최근 입고 단가 기준입니다 (PROVISIONAL P-12).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
          >
            판매 CSV 업로드
          </Link>
          <Link
            to="/inventory"
            className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
          >
            입고 단가 등록
          </Link>
        </div>
      </div>

      {/* 상단 핵심 지표 카드 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">
            누적 순매출 (취소 제외)
          </div>
          <div className="mt-1 text-2xl font-bold text-gray-900">
            {sales
              ? `${Number(sales.total_net_sales).toLocaleString("ko-KR")}원`
              : "0원"}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            완료 주문 {sales?.total_completed_orders ?? 0}건
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">
            누적 판매 수량
          </div>
          <div className="mt-1 text-2xl font-bold text-gray-900">
            {sales?.total_quantity ?? 0}개
          </div>
          <div className="mt-1 text-xs text-gray-500">
            시각 확인 {sales?.known_hour_quantity ?? 0}개 / 시각 미상{" "}
            {sales?.unknown_hour_quantity ?? 0}개
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">
            원가 산정 단가 기준
          </div>
          <div className="mt-1 text-sm font-bold text-gray-900">
            최근 입고 단가 (PROVISIONAL P-12)
          </div>
          <div className="mt-1 text-xs text-gray-500">
            시뮬레이션은 DB 원본 단가를 변경하지 않습니다
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">
            고원가율 주의 메뉴 (≥ 35%)
          </div>
          <div
            className={`mt-1 text-2xl font-bold ${
              highCostCount > 0 ? "text-amber-700" : "text-gray-900"
            }`}
          >
            {highCostCount}개
          </div>
          <div className="mt-1 text-xs text-gray-500">
            일괄{" "}
            {globalChangePercent > 0
              ? `+${globalChangePercent}`
              : globalChangePercent}
            %{" "}
            {customIngredientCount > 0
              ? `(개별 식자재 ${customIngredientCount}종 지정)`
              : ""}
          </div>
        </div>
      </div>

      {/* 섹션 1: 메뉴별 원가·원가율 및 비파괴 단가 변동 시나리오 (REQ-010) */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              메뉴별 레시피 원가 · 원가율 및 단가 변동 시나리오 시뮬레이터
            </h2>
            <p className="text-xs text-gray-500">
              식자재 구매단가가 상승/하락할 때 메뉴별 원가율과 마진 변화를 즉시 시뮬레이션합니다. 각 메뉴의 <strong>[구성 식자재 ▼]</strong>를 열면 특정 식자재만 개별 변동률을 지정할 수도 있습니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-gray-700 mr-1">
              전체 일괄 변동률:
            </span>
            {[-5, 0, 5, 10, 20].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setGlobalChangePercent(pct)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-bold ${
                  globalChangePercent === pct
                    ? "border-accent-600 bg-accent-50 text-accent-800"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                }`}
              >
                {pct === 0 ? "0% (현재)" : pct > 0 ? `+${pct}%` : `${pct}%`}
              </button>
            ))}
            {customIngredientCount > 0 && (
              <button
                type="button"
                onClick={() => setIngredientChanges({})}
                className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                개별 식자재 변동률 초기화 ({customIngredientCount}건)
              </button>
            )}
          </div>
        </div>

        {(costing?.menus ?? []).length === 0 ? (
          <p className="text-xs text-gray-500">
            등록된 활성 메뉴가 없습니다. 메뉴 관리에서 메뉴와 레시피를 등록해 주세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-gray-200 text-gray-600">
                <tr>
                  <th className="px-3 py-2">메뉴명</th>
                  <th className="px-3 py-2 text-right">판매가</th>
                  <th className="px-3 py-2 text-right">현재 레시피 원가</th>
                  <th className="px-3 py-2 text-right">현재 원가율</th>
                  <th className="px-3 py-2 text-right bg-accent-50/60 text-accent-950">
                    시뮬레이션 원가 (
                    {globalChangePercent >= 0
                      ? `+${globalChangePercent}%`
                      : `${globalChangePercent}%`}
                    )
                  </th>
                  <th className="px-3 py-2 text-right bg-accent-50/60 text-accent-950">
                    시뮬레이션 마진 / 원가율
                  </th>
                  <th className="px-3 py-2">원가 산정 상태</th>
                  <th className="px-3 py-2 text-right">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {(costing?.menus ?? []).map((m) => {
                  const isExpanded = expandedMenuId === m.menu_item_id;
                  return (
                    <Fragment key={m.menu_item_id}>
                      <tr>
                        <td className="px-3 py-2.5 font-bold text-gray-900">
                          {m.menu_name}
                          {m.category && (
                            <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[12px] font-normal text-gray-600">
                              {m.category}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right">
                          {m.selling_price !== null
                            ? `${Number(m.selling_price).toLocaleString("ko-KR")}원`
                            : "미설정"}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right font-semibold text-gray-900">
                          {Number(m.base_recipe_cost).toLocaleString("ko-KR")}원
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right">
                          {m.base_cost_ratio_percent !== null
                            ? `${m.base_cost_ratio_percent}%`
                            : "-"}
                        </td>
                        <td className="px-3 py-2.5 bg-accent-50/30 tabular-nums text-right font-bold text-accent-950">
                          {Number(m.simulated_recipe_cost).toLocaleString("ko-KR")}원
                          {Number(m.cost_delta) !== 0 && (
                            <span
                              className={`ml-1 text-[12px] ${
                                Number(m.cost_delta) > 0
                                  ? "text-red-600"
                                  : "text-emerald-700"
                              }`}
                            >
                              ({Number(m.cost_delta) > 0 ? "+" : ""}
                              {Number(m.cost_delta).toLocaleString("ko-KR")}원)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 bg-accent-50/30 tabular-nums text-right">
                          {m.simulated_margin !== null ? (
                            <div>
                              <span className="font-semibold text-gray-900">
                                마진{" "}
                                {Number(m.simulated_margin).toLocaleString(
                                  "ko-KR"
                                )}
                                원
                              </span>
                              <span
                                className={`ml-1.5 rounded px-1.5 py-0.5 text-[12px] font-bold ${
                                  m.simulated_cost_ratio_percent === null
                                    ? "bg-gray-100 text-gray-600"
                                    : m.high_cost_warning
                                      ? "bg-amber-100 text-amber-900"
                                      : "bg-emerald-100 text-emerald-900"
                                }`}
                              >
                                {m.simulated_cost_ratio_percent !== null
                                  ? `${m.simulated_cost_ratio_percent}%`
                                  : "—"}
                              </span>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {m.cost_status === "COMPLETE" ? (
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[12px] font-semibold text-emerald-900">
                              계산 완료
                            </span>
                          ) : m.cost_status === "NO_RECIPE" ? (
                            <span className="rounded bg-gray-200 px-2 py-0.5 text-[12px] text-gray-700">
                              레시피 미등록
                            </span>
                          ) : (
                            <div>
                              <span className="rounded bg-amber-100 px-2 py-0.5 text-[12px] font-semibold text-amber-900">
                                단가 일부 미등록
                              </span>
                              <div className="mt-0.5 text-[12px] text-amber-800">
                                미입고: {m.missing_cost_ingredients.join(", ")}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {m.breakdown.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedMenuId(
                                  isExpanded ? null : m.menu_item_id
                                )
                              }
                              className="rounded border border-gray-300 px-2 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-100"
                            >
                              {isExpanded ? "접기 ▲" : "구성 식자재 ▼"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="text-[12px] font-bold text-gray-700 mb-1.5">
                              [{m.menu_name}] 레시피 식자재별 원가 분해 및 개별 단가 시뮬레이션 (최근 입고 단가 기준)
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                              {m.breakdown.map((b) => {
                                const customVal =
                                  ingredientChanges[b.ingredient_id] ??
                                  globalChangePercent;
                                return (
                                  <div
                                    key={b.ingredient_id}
                                    className="rounded border border-gray-200 bg-white px-3 py-2 text-xs space-y-1.5"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-semibold text-gray-900">
                                        {b.ingredient_name} ({Number(b.quantity)}{" "}
                                        {b.base_unit})
                                      </span>
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="number"
                                          step="1"
                                          min="-90"
                                          max="500"
                                          value={customVal}
                                          onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setIngredientChanges((prev) => ({
                                              ...prev,
                                              [b.ingredient_id]:
                                                Number.isFinite(val) ? val : 0,
                                            }));
                                          }}
                                          className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums text-[12px]"
                                        />
                                        <span className="text-[12px] text-gray-500">
                                          %
                                        </span>
                                      </div>
                                    </div>
                                    {b.base_line_cost !== null ? (
                                      <div className="text-[12px] text-gray-600 tabular-nums">
                                        현재:{" "}
                                        {Number(
                                          b.base_line_cost
                                        ).toLocaleString("ko-KR")}
                                        원 → 시뮬레이션:{" "}
                                        <strong className="text-accent-900">
                                          {Number(
                                            b.simulated_line_cost
                                          ).toLocaleString("ko-KR")}
                                          원
                                        </strong>
                                      </div>
                                    ) : (
                                      <div className="text-[12px] text-amber-700">
                                        입고 단가 미등록 (입고·재고에서 등록)
                                      </div>
                                    )}
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
      </div>

      {/* 섹션 2: 시간대별 · 메뉴별 판매량 집계 (REQ-012) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 시간대별 판매량 분포 */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              시간대별 판매 수량 · 매출 분포
            </h2>
            <p className="text-xs text-gray-500">
              주문 시각(`order_time`)이 존재하는 완료 주문만 시간대 버킷에 집계하며, 일자만 존재하는 주문({sales?.unknown_hour_quantity ?? 0}개)은 0시 왜곡을 막기 위해 별도 분리합니다.
            </p>
          </div>

          {(sales?.known_hour_quantity ?? 0) === 0 ? (
            <p className="py-6 text-center text-xs text-gray-500">
              아직 주문 시각이 포함된 판매 데이터가 없습니다.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {(sales?.hourly_buckets ?? [])
                .filter((b) => b.quantity > 0 || (b.hour >= 11 && b.hour <= 21))
                .map((b) => {
                  const widthPct = Math.round((b.quantity / maxHourQty) * 100);
                  return (
                    <div
                      key={b.hour}
                      className="grid grid-cols-[52px_1fr_110px] items-center gap-2 text-xs"
                    >
                      <span className="tabular-nums text-gray-600">
                        {String(b.hour).padStart(2, "0")}:00
                      </span>
                      <div className="h-4 w-full rounded bg-gray-100 overflow-hidden">
                        <div
                          className="h-full bg-accent-600 transition-[width]"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                      <span className="text-right tabular-nums text-gray-800">
                        <strong>{b.quantity}개</strong> (
                        {Number(b.sales_amount).toLocaleString("ko-KR")}원)
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* 메뉴별 판매량 순위 */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              메뉴별 판매량 · 매출 순위 (취소 제외)
            </h2>
            <p className="text-xs text-gray-500">
              미매핑(`UNMAPPED`) 상품은 설정에서 내부 메뉴에 연결하면 즉시 통합 집계됩니다.
            </p>
          </div>

          {(sales?.menu_rankings ?? []).length === 0 ? (
            <p className="py-6 text-center text-xs text-gray-500">
              아직 수집된 판매 내역이 없습니다.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-gray-200 text-gray-600">
                  <tr>
                    <th className="px-3 py-2">순위</th>
                    <th className="px-3 py-2">메뉴 / 상품명</th>
                    <th className="px-3 py-2">매핑 상태</th>
                    <th className="px-3 py-2 text-right">판매 수량</th>
                    <th className="px-3 py-2 text-right">순매출</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {(sales?.menu_rankings ?? []).map((r, idx) => (
                    <tr key={`${r.menu_name}-${idx}`}>
                      <td className="px-3 py-2 tabular-nums font-bold text-gray-600">
                        #{idx + 1}
                      </td>
                      <td className="px-3 py-2 font-semibold text-gray-900">
                        {r.menu_name}
                      </td>
                      <td className="px-3 py-2">
                        {r.mapping_status === "MAPPED" ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[12px] font-semibold text-emerald-900">
                            연결됨
                          </span>
                        ) : (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[12px] font-semibold text-amber-900">
                            미매핑
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">
                        {r.quantity}개
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(r.sales_amount).toLocaleString("ko-KR")}원
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
