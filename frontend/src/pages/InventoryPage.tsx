import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLink as Link } from "../components/AppLink";
import { useUrlState } from "../lib/useUrlState";
import { ApiClientError } from "../api/client";
import {
  createAdjustment,
  createCount,
  createReceipt,
  fetchInventorySummary,
  fetchReceipts,
} from "../api/inventory";
import type {
  AdjustmentReasonType,
  IngredientInventoryItem,
  Store,
} from "../types";

interface InventoryPageProps {
  store: Store;
}

const REASON_LABELS: Record<AdjustmentReasonType, string> = {
  WASTE: "조리 폐기 / 로스",
  SPOILAGE: "유통기한 경과 / 변질",
  CORRECTION: "수량 오차 보정",
  OTHER: "기타 조정",
};

export function InventoryPage({ store }: InventoryPageProps) {
  const queryClient = useQueryClient();
  const [selectedIngredientId, setSelectedIngredientId] = useUrlState<string>("ingredient", "");
  const [activeTab, setActiveTab] = useUrlState<"RECEIPT" | "COUNT" | "ADJUST">(
    "tab", "RECEIPT", ["RECEIPT", "COUNT", "ADJUST"]
  );

  // 입고 폼 상태
  const [purchaseQty, setPurchaseQty] = useState("1");
  const [totalCost, setTotalCost] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");

  // 실재고 실사 폼 상태
  const [actualQty, setActualQty] = useState("");
  const [countNotes, setCountNotes] = useState("");

  // 폐기/조정 폼 상태
  const [deltaQty, setDeltaQty] = useState("-100");
  const [adjReason, setAdjReason] = useState<AdjustmentReasonType>("WASTE");
  const [adjNotes, setAdjNotes] = useState("");

  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["inventory-summary", store.id],
    queryFn: () => fetchInventorySummary(store.id, false),
  });

  const receiptsQuery = useQuery({
    queryKey: ["inventory-receipts", store.id],
    queryFn: () => fetchReceipts(store.id),
  });

  const items = summaryQuery.data ?? [];
  const currentIngredient: IngredientInventoryItem | undefined =
    items.find((i) => i.ingredient_id === selectedIngredientId) ?? items[0];

  function refreshInventory() {
    queryClient.invalidateQueries({ queryKey: ["inventory-summary", store.id] });
    queryClient.invalidateQueries({ queryKey: ["inventory-receipts", store.id] });
  }

  const createReceiptMutation = useMutation({
    mutationFn: () => {
      if (!currentIngredient) throw new Error("식자재를 먼저 선택해 주세요.");
      const pQty = Number(purchaseQty);
      const tCost = Number(totalCost);
      if (!Number.isFinite(pQty) || pQty <= 0) {
        throw new Error("구매 수량은 0보다 커야 합니다.");
      }
      if (!Number.isFinite(tCost) || tCost < 0) {
        throw new Error("총 구매금액은 0 이상이어야 합니다.");
      }
      return createReceipt(store.id, {
        ingredient_id: currentIngredient.ingredient_id,
        purchase_quantity: pQty,
        total_cost: tCost,
        supplier_name: supplierName.trim() || null,
        notes: receiptNotes.trim() || null,
      });
    },
    onSuccess: (created) => {
      refreshInventory();
      setTotalCost("");
      setReceiptNotes("");
      setBanner({
        type: "success",
        text: `'${created.ingredient_name}' 입고 등록 완료: ${Number(
          created.purchase_quantity
        )} ${created.purchase_unit} (환산 ${Number(
          created.base_quantity
        ).toLocaleString("ko-KR")} ${created.base_unit}, 단가 ${Number(
          created.unit_cost_per_base
        )}원/${created.base_unit}) — 과거 단가 이력 보존됨`,
      });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "입고 등록에 실패했습니다.";
      setBanner({ type: "error", text: msg });
    },
  });

  const createCountMutation = useMutation({
    mutationFn: () => {
      if (!currentIngredient) throw new Error("식자재를 먼저 선택해 주세요.");
      const aQty = Number(actualQty);
      if (!Number.isFinite(aQty) || aQty < 0) {
        throw new Error("실재고 실사 수량은 0 이상이어야 합니다.");
      }
      return createCount(store.id, {
        ingredient_id: currentIngredient.ingredient_id,
        actual_quantity: aQty,
        notes: countNotes.trim() || null,
      });
    },
    onSuccess: (created) => {
      refreshInventory();
      setActualQty("");
      setCountNotes("");
      setBanner({
        type: "success",
        text: `'${created.ingredient_name}' 실재고 실사(${Number(
          created.actual_quantity
        ).toLocaleString("ko-KR")} ${created.base_unit})가 기록되었으며 예상 재고 기준점이 현재 시각으로 갱신되었습니다.`,
      });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "실재고 실사 등록에 실패했습니다.";
      setBanner({ type: "error", text: msg });
    },
  });

  const createAdjustmentMutation = useMutation({
    mutationFn: () => {
      if (!currentIngredient) throw new Error("식자재를 먼저 선택해 주세요.");
      const dQty = Number(deltaQty);
      if (!Number.isFinite(dQty) || dQty === 0) {
        throw new Error("조정 수량은 0이 아닌 숫자여야 합니다 (폐기는 음수 입력).");
      }
      return createAdjustment(store.id, {
        ingredient_id: currentIngredient.ingredient_id,
        quantity_delta: dQty,
        reason: adjReason,
        notes: adjNotes.trim() || null,
      });
    },
    onSuccess: (created) => {
      refreshInventory();
      setAdjNotes("");
      setBanner({
        type: "success",
        text: `'${created.ingredient_name}' 재고 조정(${Number(
          created.quantity_delta
        ).toLocaleString("ko-KR")} ${created.base_unit}, ${
          REASON_LABELS[created.reason]
        })이 반영되었습니다.`,
      });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "재고 조정 등록에 실패했습니다.";
      setBanner({ type: "error", text: msg });
    },
  });

  const lowStockCount = items.filter((i) => i.stock_status !== "OK").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">입고 · 재고</h1>
          <p className="text-sm text-gray-600">
            <strong>실재고(현장 실사값)</strong>와{" "}
            <strong>예상 재고(입고 - 판매·레시피 이론소모량 ± 조정 추정치)</strong>를 분리해 표시합니다. 원가 단가는 최근 입고 단가 기준입니다 (PROVISIONAL P-12).
          </p>
        </div>
        <Link
          to="/ingredients"
          className="rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
        >
          식자재 · 단위 마스터 관리 →
        </Link>
      </div>

      {banner && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm ${
            banner.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs underline"
          >
            닫기
          </button>
        </div>
      )}

      {/* 상단 요약 배너 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">
            관리 중인 활성 식자재
          </div>
          <div className="mt-1 text-2xl font-bold text-gray-900">
            {items.length}종
          </div>
          <div className="mt-1 text-xs text-gray-500">
            기본 단위(g/ml/ea) 환산 기준
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">
            안전재고 부족 / 음수 점검 필요
          </div>
          <div
            className={`mt-1 text-2xl font-bold ${
              lowStockCount > 0 ? "text-amber-700" : "text-emerald-700"
            }`}
          >
            {lowStockCount}종
          </div>
          <div className="mt-1 text-xs text-gray-500">
            예상 재고 ≤ 안전재고 또는 0 미만
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">
            원가 산정 단가 기준 (D-05 / P-12)
          </div>
          <div className="mt-1 text-sm font-bold text-gray-900">
            최근 입고 단가 기준 (PROVISIONAL)
          </div>
          <div className="mt-1 text-xs text-gray-500">
            입고 시 과거 단가 이력은 덮어쓰지 않고 모두 보존됩니다
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-600">
          등록된 활성 식자재가 없습니다. 먼저{" "}
          <Link to="/ingredients" className="font-bold text-accent-600 underline">
            식자재·레시피
          </Link>{" "}
          화면에서 식자재를 등록해 주세요.
        </div>
      ) : (
        <>
          {/* 입고 / 실사 / 폐기·조정 빠른 입력 카드 */}
          <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-gray-700">
                  대상 식자재 선택:
                </label>
                <select
                  value={currentIngredient?.ingredient_id ?? ""}
                  onChange={(e) => setSelectedIngredientId(e.target.value)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-900"
                >
                  {items.map((i) => (
                    <option key={i.ingredient_id} value={i.ingredient_id}>
                      {i.ingredient_name} (구매: {i.purchase_unit} → 기본:{" "}
                      {i.base_unit}, 변환 ×{Number(i.conversion_factor)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveTab("RECEIPT")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    activeTab === "RECEIPT"
                      ? "bg-accent-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  + 입고 · 구매단가 등록
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("COUNT")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    activeTab === "COUNT"
                      ? "bg-accent-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  실재고 실사 입력
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("ADJUST")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    activeTab === "ADJUST"
                      ? "bg-accent-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  ± 폐기 · 수량 보정
                </button>
              </div>
            </div>

            {activeTab === "RECEIPT" && currentIngredient && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-5 items-end">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    입고 수량 (구매단위: {currentIngredient.purchase_unit})
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={purchaseQty}
                    onChange={(e) => setPurchaseQty(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    총 구매금액 (원)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={totalCost}
                    onChange={(e) => setTotalCost(e.target.value)}
                    placeholder="예: 30000"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    공급처 (선택)
                  </label>
                  <input
                    type="text"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="예: 이탈리아푸드"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    메모 (선택)
                  </label>
                  <input
                    type="text"
                    value={receiptNotes}
                    onChange={(e) => setReceiptNotes(e.target.value)}
                    placeholder="명세서 번호 등"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={createReceiptMutation.isPending}
                  onClick={() => createReceiptMutation.mutate()}
                  className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-bold text-white hover:bg-accent-700 disabled:opacity-50"
                >
                  입고 저장
                </button>
              </div>
            )}

            {activeTab === "COUNT" && currentIngredient && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 items-end">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    실제 확인한 실재고 수량 (기본단위: {currentIngredient.base_unit})
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={actualQty}
                    onChange={(e) => setActualQty(e.target.value)}
                    placeholder={`현재 예상 재고: ${Number(
                      currentIngredient.estimated_quantity
                    ).toLocaleString("ko-KR")} ${currentIngredient.base_unit}`}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    실사 메모 (선택)
                  </label>
                  <input
                    type="text"
                    value={countNotes}
                    onChange={(e) => setCountNotes(e.target.value)}
                    placeholder="예: 마감 실사"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={createCountMutation.isPending}
                  onClick={() => createCountMutation.mutate()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  실재고 기준점 저장
                </button>
              </div>
            )}

            {activeTab === "ADJUST" && currentIngredient && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 items-end">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    증감 수량 ({currentIngredient.base_unit}, 폐기는 음수)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={deltaQty}
                    onChange={(e) => setDeltaQty(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    사유
                  </label>
                  <select
                    value={adjReason}
                    onChange={(e) =>
                      setAdjReason(e.target.value as AdjustmentReasonType)
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    {(Object.keys(REASON_LABELS) as AdjustmentReasonType[]).map(
                      (r) => (
                        <option key={r} value={r}>
                          {REASON_LABELS[r]}
                        </option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-700">
                    비고 (선택)
                  </label>
                  <input
                    type="text"
                    value={adjNotes}
                    onChange={(e) => setAdjNotes(e.target.value)}
                    placeholder="상세 사유"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={createAdjustmentMutation.isPending}
                  onClick={() => createAdjustmentMutation.mutate()}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  폐기·조정 반영
                </button>
              </div>
            )}
          </div>

          {/* 식자재별 실재고 vs 예상 재고 분리 비교 표 */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-base font-bold text-gray-900">
              식자재별 실재고(실사) · 이론 소모량 · 예상 재고(추정) 현황
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              계산식: <code>예상 재고 = 최근 실재고 실사값 + 실사 이후 입고량 - 판매×레시피 이론 소모량 ± 폐기/조정</code>
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-gray-200 text-gray-600">
                  <tr>
                    <th className="px-3 py-2">식자재명</th>
                    <th className="px-3 py-2">최근 입고 단가 (PROVISIONAL P-12)</th>
                    <th className="px-3 py-2 bg-emerald-50/60 text-emerald-950">
                      최근 실재고 (실사 확인값)
                    </th>
                    <th className="px-3 py-2 text-right">+ 입고량</th>
                    <th className="px-3 py-2 text-right">- 이론 소모량 (판매×레시피)</th>
                    <th className="px-3 py-2 text-right">± 폐기/조정</th>
                    <th className="px-3 py-2 text-right bg-accent-50/60 text-accent-950">
                      현재 예상 재고 (추정치)
                    </th>
                    <th className="px-3 py-2">안전재고 상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {items.map((row) => (
                    <tr key={row.ingredient_id}>
                      <td className="px-3 py-2.5 font-bold text-gray-900">
                        {row.ingredient_name}
                        <div className="text-[12px] font-normal text-gray-500">
                          기본: {row.base_unit} / 구매: {row.purchase_unit}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {row.latest_unit_cost_per_purchase ? (
                          <div>
                            <span className="font-semibold text-gray-900">
                              {Number(
                                row.latest_unit_cost_per_purchase
                              ).toLocaleString("ko-KR")}
                              원/{row.purchase_unit}
                            </span>
                            <div className="text-[12px] text-gray-500">
                              ({Number(row.latest_unit_cost_per_base)}원/
                              {row.base_unit})
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-500">입고 단가 미등록</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 bg-emerald-50/30 tabular-nums">
                        {row.last_actual_quantity !== null ? (
                          <div>
                            <strong className="text-emerald-900">
                              {Number(row.last_actual_quantity).toLocaleString(
                                "ko-KR"
                              )}{" "}
                              {row.base_unit}
                            </strong>
                            <div className="text-[12px] text-gray-500">
                              {row.last_counted_at
                                ? new Date(
                                    row.last_counted_at
                                  ).toLocaleTimeString("ko-KR")
                                : ""}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-500">
                            미실사 (0 {row.base_unit} 기준)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-right text-gray-700">
                        +{Number(row.receipts_since_count_base).toLocaleString("ko-KR")}{" "}
                        {row.base_unit}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-right text-gray-700">
                        -{Number(row.theoretical_consumption_base).toLocaleString("ko-KR")}{" "}
                        {row.base_unit}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-right text-gray-700">
                        {Number(row.adjustments_since_count_base) > 0 ? "+" : ""}
                        {Number(row.adjustments_since_count_base).toLocaleString("ko-KR")}{" "}
                        {row.base_unit}
                      </td>
                      <td className="px-3 py-2.5 bg-accent-50/30 tabular-nums text-right font-bold text-accent-950">
                        {Number(row.estimated_quantity).toLocaleString("ko-KR")}{" "}
                        {row.base_unit}{" "}
                        <span className="text-[12px] font-normal text-accent-700">
                          (추정)
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {row.stock_status === "NEGATIVE_WARNING" ? (
                          <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-[12px] font-bold text-red-900">
                            음수 재고 (입고누락/실사점검 필요)
                          </span>
                        ) : row.stock_status === "LOW_STOCK" ? (
                          <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-[12px] font-bold text-amber-900">
                            ● 안전재고 이하 (발주 권장)
                          </span>
                        ) : (
                          <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-[12px] font-semibold text-emerald-900">
                            정상
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 하단: 입고 및 구매단가 변동 이력 보존 표 */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-bold text-gray-900">
              입고 및 구매단가 변동 이력
            </h2>
            {(receiptsQuery.data ?? []).length === 0 ? (
              <p className="mt-2 text-xs text-gray-500">
                아직 등록된 입고 내역이 없습니다.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="border-b border-gray-200 text-gray-600">
                    <tr>
                      <th className="px-3 py-2">입고 시각</th>
                      <th className="px-3 py-2">식자재</th>
                      <th className="px-3 py-2 text-right">구매 수량</th>
                      <th className="px-3 py-2 text-right">환산 수량 (기본단위)</th>
                      <th className="px-3 py-2 text-right">총 구매금액</th>
                      <th className="px-3 py-2 text-right">구매단위당 단가</th>
                      <th className="px-3 py-2 text-right">기본단위당 단가</th>
                      <th className="px-3 py-2">공급처</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {(receiptsQuery.data ?? []).slice(0, 20).map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 tabular-nums">
                          {new Date(r.received_at).toLocaleString("ko-KR")}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {r.ingredient_name}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-right">
                          {Number(r.purchase_quantity).toLocaleString("ko-KR")}{" "}
                          {r.purchase_unit}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-right">
                          {Number(r.base_quantity).toLocaleString("ko-KR")}{" "}
                          {r.base_unit}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-right font-semibold">
                          {Number(r.total_cost).toLocaleString("ko-KR")}원
                        </td>
                        <td className="px-3 py-2 tabular-nums text-right">
                          {Number(r.unit_cost_per_purchase).toLocaleString(
                            "ko-KR"
                          )}
                          원/{r.purchase_unit}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-right">
                          {Number(r.unit_cost_per_base)}원/{r.base_unit}
                        </td>
                        <td className="px-3 py-2">{r.supplier_name ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
