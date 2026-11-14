import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLink as Link } from "../components/AppLink";
import { Dialog } from "../components/Dialog";
import { HeroKpi } from "../components/HeroKpi";
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

// 상태는 한 단어. 정상 파랑 / 부족 노랑 / 점검(예상 재고 음수) 빨강
const STATUS: Record<StockAlertStatusType, { label: string; className: string }> = {
  OK: { label: "정상", className: "chip-ok" },
  LOW_STOCK: { label: "부족", className: "chip-warn" },
  NEGATIVE_WARNING: { label: "점검", className: "chip-danger" },
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

  const input = "h-10 w-full rounded-xl bg-ground px-3 text-sm text-ink";
  const signed = action === "ADJUST" && (reason === "CORRECTION" || reason === "OTHER");

  return (
    <Dialog label={`${item.ingredient_name} ${ACTION_LABELS[action]}`} onClose={onClose}>
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3 shadow-xl">
        <div className="card-head !mb-2">
          <h2>
            {item.ingredient_name} {ACTION_LABELS[action]}
          </h2>
        </div>

        {action === "ADJUST" && (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="사유">
            {(Object.keys(REASON_LABELS) as AdjustmentReasonType[]).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                aria-pressed={reason === r}
                onClick={() => setReason(r)}
                className="pill pill-sm pill-soft"
              >
                {REASON_LABELS[r]}
              </button>
            ))}
          </div>
        )}

        <label className="block text-xs font-medium text-muted">
          {action === "COUNT" ? "실재고" : signed ? "수량 (빼려면 -)" : "수량"}
          <div className="mt-1 flex gap-2">
            <input
              autoFocus
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={`${input} tabular-nums`}
            />
            {action === "RECEIPT" && units.length > 1 ? (
              <select
                aria-label="단위"
                value={unit}
                onChange={(e) => setUnit(e.target.value as PurchaseUnitType)}
                className="h-10 rounded-xl bg-ground px-3 text-sm text-ink"
              >
                {units.map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="self-center text-sm text-muted">
                {unitLabel(action === "RECEIPT" ? unit : item.base_unit)}
              </span>
            )}
          </div>
        </label>

        {action === "RECEIPT" && (
          <>
            <label className="block text-xs font-medium text-muted">
              총 금액 (원)
              <input
                inputMode="numeric"
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value)}
                className={`mt-1 ${input} tabular-nums`}
              />
            </label>
            <label className="block text-xs font-medium text-muted">
              공급처
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={`mt-1 ${input}`} />
            </label>
          </>
        )}

        <label className="block text-xs font-medium text-muted">
          메모
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`mt-1 ${input}`} />
        </label>

        {error && <p className="text-xs font-semibold text-[#b42318]">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="pill pill-sm pill-soft">
            취소
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="pill pill-sm pill-primary"
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

  return (
    <div>
      <div className="page-heading">
        <div className="page-title">
          <h1>입고 · 재고</h1>
          <span className="title-divider" />
          <span className="title-meta">{items.length}종</span>
        </div>
        <div className="page-actions">
          <Link to="/ingredients" className="pill pill-secondary">
            식자재 관리 →
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-4 xl:gap-5">
        {banner && (
          <div role="status" className="rounded-2xl bg-accent-50 px-4 py-3 text-sm font-semibold text-accent-700">
            {banner}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:gap-5">
          <HeroKpi label="부족 · 점검" value={alerts} unit="종" tone={alerts > 0 ? "alert" : "normal"}>
            활성 식자재 {items.length}종
          </HeroKpi>

          <section className="card md:col-span-2">
            <div className="card-head !mb-3">
              <h2>단가 변동 (최근 입고 대 평균)</h2>
              <span className="card-meta">최근 입고 {receipts.length}건</span>
            </div>
            {changes.length === 0 ? (
              <p className="text-sm text-muted">입고 2건 이상부터</p>
            ) : (
              <ol className="flex flex-col gap-2 text-sm">
                {changes.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-ink">{c.name}</span>
                    <span
                      className={`font-semibold tabular-nums ${
                        c.percent > 0 ? "text-[#b42318]" : "text-accent-700"
                      }`}
                    >
                      {c.percent > 0 ? "▲" : "▼"} {Math.abs(c.percent).toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {summaryQuery.isError && (
          <p className="text-sm text-[#b42318]">{errorText(summaryQuery.error, "재고를 불러오지 못했습니다.")}</p>
        )}

        {!summaryQuery.isLoading && items.length === 0 ? (
          <section className="card py-12 text-center">
            <p className="text-sm text-muted">등록된 식자재가 없습니다</p>
            <Link to="/ingredients" className="pill pill-primary mt-4">
              식자재 추가
            </Link>
          </section>
        ) : (
          <section className="card">
            <div className="card-head">
              <h2>재고 현황</h2>
              <span className="card-meta">활성 {items.length}종</span>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>식자재</th>
                    <th className="!text-right">최근 입고 단가</th>
                    <th className="!text-right">마지막 실사</th>
                    <th className="!text-right">실사 후 입고</th>
                    <th className="!text-right">실사 후 소모</th>
                    <th className="!text-right">실사 후 폐기·보정</th>
                    <th className="!text-right">예상 재고</th>
                    <th>상태</th>
                    <th className="!text-right">
                      <span className="sr-only">기록</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const u = unitLabel(i.base_unit);
                    const status = STATUS[i.stock_status];
                    return (
                      <tr key={i.ingredient_id}>
                        <td className="font-semibold">{i.ingredient_name}</td>
                        <td className="!text-right tabular-nums">
                          {i.latest_unit_cost_per_purchase === null
                            ? "-"
                            : `${fmt(i.latest_unit_cost_per_purchase)}원/${unitLabel(i.purchase_unit)}`}
                        </td>
                        <td className="!text-right tabular-nums">
                          {i.last_actual_quantity === null ? (
                            <span className="text-muted">없음</span>
                          ) : (
                            <>
                              {fmt(i.last_actual_quantity)}
                              {u}
                              {i.last_counted_at && (
                                <span className="ml-1.5 text-xs text-muted">
                                  ({new Date(i.last_counted_at).toLocaleDateString("ko-KR")})
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="!text-right font-medium text-accent-700 tabular-nums">
                          +{fmt(i.receipts_since_count_base)}
                          {u}
                        </td>
                        <td className="!text-right text-muted tabular-nums">
                          -{fmt(i.theoretical_consumption_base)}
                          {u}
                        </td>
                        <td className="!text-right text-muted tabular-nums">
                          {fmt(i.adjustments_since_count_base)}
                          {u}
                        </td>
                        <td className="!text-right font-semibold tabular-nums">
                          {fmt(i.estimated_quantity)}
                          {u}
                        </td>
                        <td>
                          <span className={`chip ${status.className}`}>{status.label}</span>
                        </td>
                        <td className="!text-right">
                          <div className="flex justify-end gap-1.5">
                            {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
                              <button
                                key={a}
                                type="button"
                                onClick={() => {
                                  setBanner(null);
                                  setActive({ item: i, action: a });
                                }}
                                className={`pill pill-sm ${a === "RECEIPT" ? "pill-dark" : "pill-soft"}`}
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
          </section>
        )}

        <details className="card group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-base font-semibold tracking-[-0.4px] text-ink">
            <span className="flex items-center gap-2">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4 -rotate-90 text-muted transition-transform group-open:rotate-0"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
              입고 · 단가 이력
            </span>
            <span className="card-meta">{receipts.length}건</span>
          </summary>
          {receipts.length === 0 ? (
            <p className="mt-4 text-sm text-muted">입고 기록이 없습니다</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>입고 일시</th>
                    <th>식자재</th>
                    <th className="!text-right">수량</th>
                    <th className="!text-right">금액</th>
                    <th className="!text-right">단가</th>
                    <th>공급처</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.slice(0, 50).map((r) => (
                    <tr key={r.id}>
                      <td className="text-muted tabular-nums">{new Date(r.received_at).toLocaleString("ko-KR")}</td>
                      <td className="font-semibold">{r.ingredient_name}</td>
                      <td className="!text-right tabular-nums">
                        {fmt(r.purchase_quantity)}
                        {unitLabel(r.purchase_unit)}
                      </td>
                      <td className="!text-right tabular-nums">{fmt(r.total_cost)}원</td>
                      <td className="!text-right tabular-nums">
                        {fmt(r.unit_cost_per_purchase)}원/{unitLabel(r.purchase_unit)}
                      </td>
                      <td className="text-muted">{r.supplier_name ?? "-"}</td>
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
    </div>
  );
}
