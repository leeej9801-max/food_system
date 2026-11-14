import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLink as Link } from "../components/AppLink";
import { Dialog } from "../components/Dialog";
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
  InventoryReceipt,
  PurchaseUnitType,
  StockAlertStatusType,
  Store,
} from "../types";

interface InventoryPageProps {
  store: Store;
}

type Action = "RECEIPT" | "COUNT" | "ADJUST";

const ACTION_LABELS: Record<Action, string> = { RECEIPT: "입고", COUNT: "실사", ADJUST: "폐기·보정" };

const REASON_LABELS: Record<AdjustmentReasonType, string> = {
  WASTE: "조리 폐기",
  SPOILAGE: "유통기한 경과",
  CORRECTION: "수량 보정",
  OTHER: "기타",
};

// 상태는 한 단어. 정상 초록 / 부족 노랑 / 점검(예상 재고 음수) 빨강
const STATUS: Record<StockAlertStatusType, { label: string; className: string }> = {
  OK: { label: "정상", className: "bg-emerald-50 text-emerald-700" },
  LOW_STOCK: { label: "부족", className: "bg-amber-50 text-amber-700" },
  NEGATIVE_WARNING: { label: "점검", className: "bg-red-50 text-red-700" },
};

const SAME_DIMENSION: Record<string, PurchaseUnitType[]> = {
  kg: ["kg", "g"],
  g: ["kg", "g"],
  L: ["L", "ml"],
  ml: ["L", "ml"],
  ea: ["ea"],
};

const unitLabel = (u: string) => (u === "ea" ? "개" : u);
const fmt = (v: string | number) => Number(v).toLocaleString("ko-KR");
const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiClientError || err instanceof Error ? err.message : fallback;

/** 식자재별 최근 입고 단가가 그 식자재 평균 입고 단가와 얼마나 다른지. 입고 2건 이상만. */
function priceChanges(receipts: InventoryReceipt[]) {
  const byIngredient = new Map<string, InventoryReceipt[]>();
  for (const r of receipts) {
    byIngredient.set(r.ingredient_id, [...(byIngredient.get(r.ingredient_id) ?? []), r]);
  }
  const rows = [];
  for (const list of byIngredient.values()) {
    if (list.length < 2) continue;
    const latest = Number(list[0].unit_cost_per_base); // 목록은 최근 입고부터
    const avg = list.reduce((sum, r) => sum + Number(r.unit_cost_per_base), 0) / list.length;
    if (avg === 0) continue;
    rows.push({ name: list[0].ingredient_name, percent: ((latest - avg) / avg) * 100 });
  }
  return rows.sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent)).slice(0, 3);
}

function ActionDialog({
  store,
  item,
  action,
  onClose,
  onDone,
}: {
  store: Store;
  item: IngredientInventoryItem;
  action: Action;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const units = SAME_DIMENSION[item.base_unit] ?? [item.base_unit as PurchaseUnitType];
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<PurchaseUnitType>(
    units.includes(item.purchase_unit as PurchaseUnitType)
      ? (item.purchase_unit as PurchaseUnitType)
      : units[0]
  );
  const [totalCost, setTotalCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reason, setReason] = useState<AdjustmentReasonType>("WASTE");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const q = Number(quantity);
      const note = notes.trim() || null;
      if (action === "RECEIPT") {
        const cost = Number(totalCost);
        if (!Number.isFinite(q) || q <= 0) throw new Error("수량은 0보다 커야 합니다.");
        if (totalCost.trim() === "" || !Number.isFinite(cost) || cost < 0)
          throw new Error("금액은 0 이상이어야 합니다.");
        await createReceipt(store.id, {
          ingredient_id: item.ingredient_id,
          purchase_quantity: q,
          purchase_unit: unit,
          total_cost: cost,
          supplier_name: supplier.trim() || null,
          notes: note,
        });
        return `${item.ingredient_name} ${fmt(q)}${unitLabel(unit)} 입고`;
      }
      if (action === "COUNT") {
        if (quantity.trim() === "" || !Number.isFinite(q) || q < 0)
          throw new Error("수량은 0 이상이어야 합니다.");
        await createCount(store.id, { ingredient_id: item.ingredient_id, actual_quantity: q, notes: note });
        return `${item.ingredient_name} 실사 ${fmt(q)}${unitLabel(item.base_unit)}`;
      }
      if (!Number.isFinite(q) || q === 0) throw new Error("수량은 0이 아니어야 합니다.");
      // 폐기는 항상 빼는 값. 보정·기타는 입력한 부호 그대로
      const delta = reason === "WASTE" || reason === "SPOILAGE" ? -Math.abs(q) : q;
      await createAdjustment(store.id, {
        ingredient_id: item.ingredient_id,
        quantity_delta: delta,
        reason,
        notes: note,
      });
      return `${item.ingredient_name} ${REASON_LABELS[reason]} ${fmt(delta)}${unitLabel(item.base_unit)}`;
    },
    onSuccess: onDone,
    onError: (err) => setError(errorText(err, "저장하지 못했습니다.")),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const signed = action === "ADJUST" && (reason === "CORRECTION" || reason === "OTHER");

  return (
    <Dialog label={`${item.ingredient_name} ${ACTION_LABELS[action]}`} onClose={onClose}>
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-bold text-gray-900">
          {item.ingredient_name} {ACTION_LABELS[action]}
        </h2>

        {action === "ADJUST" && (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="사유">
            {(Object.keys(REASON_LABELS) as AdjustmentReasonType[]).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(r)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  reason === r ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {REASON_LABELS[r]}
              </button>
            ))}
          </div>
        )}

        <label className="block text-xs font-semibold text-gray-600">
          {action === "COUNT" ? "실재고" : signed ? "수량 (빼려면 -)" : "수량"}
          <div className="mt-1 flex gap-2">
            <input
              autoFocus
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={input}
            />
            {action === "RECEIPT" && units.length > 1 ? (
              <select
                aria-label="단위"
                value={unit}
                onChange={(e) => setUnit(e.target.value as PurchaseUnitType)}
                className="rounded-lg border border-gray-300 px-2 text-sm"
              >
                {units.map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="self-center text-sm text-gray-500">
                {unitLabel(action === "RECEIPT" ? unit : item.base_unit)}
              </span>
            )}
          </div>
        </label>

        {action === "RECEIPT" && (
          <>
            <label className="block text-xs font-semibold text-gray-600">
              총 금액 (원)
              <input
                inputMode="numeric"
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value)}
                className={`mt-1 ${input}`}
              />
            </label>
            <label className="block text-xs font-semibold text-gray-600">
              공급처
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={`mt-1 ${input}`} />
            </label>
          </>
        )}

        <label className="block text-xs font-semibold text-gray-600">
          메모
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`mt-1 ${input}`} />
        </label>

        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm font-semibold text-gray-600">
            취소
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {mutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function InventoryPage({ store }: InventoryPageProps) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<{ item: IngredientInventoryItem; action: Action } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["inventory-summary", store.id],
    queryFn: () => fetchInventorySummary(store.id, false),
  });
  const receiptsQuery = useQuery({
    queryKey: ["inventory-receipts", store.id],
    queryFn: () => fetchReceipts(store.id),
  });

  const items = summaryQuery.data ?? [];
  const receipts = receiptsQuery.data ?? [];
  const alerts = items.filter((i) => i.stock_status !== "OK").length;
  const changes = priceChanges(receipts);

  function done(text: string) {
    setActive(null);
    setBanner(`${text} 완료`);
    void queryClient.invalidateQueries({ queryKey: ["inventory-summary", store.id] });
    void queryClient.invalidateQueries({ queryKey: ["inventory-receipts", store.id] });
  }

  const th = "px-3 py-2.5 font-semibold";
  const num = "px-3 py-3 text-right tabular-nums";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">입고 · 재고</h1>
        <Link to="/ingredients" className="text-sm font-semibold text-gray-600 hover:text-gray-900">
          식자재 관리 →
        </Link>
      </div>

      {banner && (
        <div role="status" className="rounded-lg bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
          {banner}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">활성 식자재</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{items.length}종</div>
        </div>
        <div className="rounded-lg bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">부족 · 점검</div>
          <div className={`mt-1 text-2xl font-bold ${alerts > 0 ? "text-amber-600" : "text-gray-900"}`}>
            {alerts}종
          </div>
        </div>
        <div className="rounded-lg bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">단가 변동 (최근 입고 대 평균)</div>
          {changes.length === 0 ? (
            <div className="mt-2 text-sm text-gray-400">입고 2건 이상부터</div>
          ) : (
            <ol className="mt-2 space-y-1 text-sm">
              {changes.map((c) => (
                <li key={c.name} className="flex justify-between">
                  <span className="truncate text-gray-800">{c.name}</span>
                  <span className={`font-semibold tabular-nums ${c.percent > 0 ? "text-red-600" : "text-blue-600"}`}>
                    {c.percent > 0 ? "▲" : "▼"} {Math.abs(c.percent).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {summaryQuery.isError && (
        <p className="text-sm text-red-600">{errorText(summaryQuery.error, "재고를 불러오지 못했습니다.")}</p>
      )}

      {!summaryQuery.isLoading && items.length === 0 ? (
        <div className="rounded-lg bg-white p-8 text-center">
          <p className="text-sm text-gray-600">등록된 식자재가 없습니다</p>
          <Link
            to="/ingredients"
            className="mt-3 inline-block rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
          >
            식자재 추가
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-xs text-gray-500">
              <tr className="border-b border-gray-100 text-left">
                <th className={th}>식자재</th>
                <th className={`${th} text-right`}>최근 입고 단가</th>
                <th className={`${th} text-right`}>마지막 실사</th>
                <th className={`${th} text-right`}>실사 후 입고</th>
                <th className={`${th} text-right`}>실사 후 소모</th>
                <th className={`${th} text-right`}>실사 후 폐기·보정</th>
                <th className={`${th} text-right`}>예상 재고</th>
                <th className={th}>상태</th>
                <th className={th}>
                  <span className="sr-only">기록</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const u = unitLabel(i.base_unit);
                const status = STATUS[i.stock_status];
                return (
                  <tr key={i.ingredient_id} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-3 font-semibold text-gray-900">{i.ingredient_name}</td>
                    <td className={num}>
                      {i.latest_unit_cost_per_purchase === null
                        ? "-"
                        : `${fmt(i.latest_unit_cost_per_purchase)}원/${unitLabel(i.purchase_unit)}`}
                    </td>
                    <td className={num}>
                      {i.last_actual_quantity === null ? (
                        <span className="text-gray-400">없음</span>
                      ) : (
                        <>
                          {fmt(i.last_actual_quantity)}
                          {u}
                          {i.last_counted_at && (
                            <div className="text-xs text-gray-400">
                              {new Date(i.last_counted_at).toLocaleDateString("ko-KR")}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className={`${num} text-emerald-700`}>+{fmt(i.receipts_since_count_base)}{u}</td>
                    <td className={`${num} text-gray-600`}>-{fmt(i.theoretical_consumption_base)}{u}</td>
                    <td className={`${num} text-gray-600`}>{fmt(i.adjustments_since_count_base)}{u}</td>
                    <td className={`${num} font-bold text-gray-900`}>{fmt(i.estimated_quantity)}{u}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => {
                              setBanner(null);
                              setActive({ item: i, action: a });
                            }}
                            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
                              a === "RECEIPT" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {ACTION_LABELS[a]}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="group rounded-lg bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold text-gray-900">
          <span aria-hidden className="text-xs text-gray-400 transition-transform group-open:rotate-90">
            ▶
          </span>
          입고 · 단가 이력
          <span className="font-normal text-gray-400">{receipts.length}건</span>
        </summary>
        {receipts.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-gray-400">입고 기록이 없습니다</p>
        ) : (
          <div className="overflow-x-auto px-1 pb-2">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-xs text-gray-500">
                <tr className="border-b border-gray-100 text-left">
                  <th className={th}>입고 일시</th>
                  <th className={th}>식자재</th>
                  <th className={`${th} text-right`}>수량</th>
                  <th className={`${th} text-right`}>금액</th>
                  <th className={`${th} text-right`}>단가</th>
                  <th className={th}>공급처</th>
                </tr>
              </thead>
              <tbody>
                {receipts.slice(0, 50).map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2.5 text-gray-600">{new Date(r.received_at).toLocaleString("ko-KR")}</td>
                    <td className="px-3 py-2.5 font-semibold text-gray-900">{r.ingredient_name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmt(r.purchase_quantity)}
                      {unitLabel(r.purchase_unit)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.total_cost)}원</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmt(r.unit_cost_per_purchase)}원/{unitLabel(r.purchase_unit)}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{r.supplier_name ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      {active && (
        <ActionDialog
          store={store}
          item={active.item}
          action={active.action}
          onClose={() => setActive(null)}
          onDone={done}
        />
      )}
    </div>
  );
}
