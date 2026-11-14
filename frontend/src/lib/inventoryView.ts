import type { AdjustmentReasonType, IngredientInventoryItem, InventoryReceipt, StockAlertStatusType } from "../types";

export type InventoryStatusFilter = "all" | "needs_receipt" | StockAlertStatusType;
export type HistoryFilter = "all" | "ingredient" | "menu";
export type AdjustmentDirection = "+" | "-";

export const INVENTORY_FILTERS: { value: InventoryStatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "needs_receipt", label: "입고 필요" },
  { value: "OK", label: "정상" },
  { value: "LOW_STOCK", label: "부족" },
  { value: "NEGATIVE_WARNING", label: "점검" },
];
export const INVENTORY_PAGE_SIZE = 20;

export function filterInventory(items: IngredientInventoryItem[], status: InventoryStatusFilter) {
  return items.filter((item) => status === "all" || (
    status === "needs_receipt" ? item.stock_status !== "OK" : item.stock_status === status
  ));
}

export function getInventoryPage(items: IngredientInventoryItem[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / INVENTORY_PAGE_SIZE));
  const page = Math.max(1, Math.min(pageCount, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1));
  const offset = (page - 1) * INVENTORY_PAGE_SIZE;
  return { page, pageCount, offset, rows: items.slice(offset, offset + INVENTORY_PAGE_SIZE) };
}

export function shortageRanking(items: IngredientInventoryItem[]) {
  return filterInventory(items, "needs_receipt")
    .filter((item) => item.safety_stock !== null && Number(item.safety_stock) > 0)
    .map((item) => ({
      item,
      shortage: (Number(item.safety_stock) - Number(item.estimated_quantity)) / Number(item.safety_stock),
    }))
    .sort((a, b) => b.shortage - a.shortage || a.item.ingredient_name.localeCompare(b.item.ingredient_name, "ko"))
    .slice(0, 3);
}

export function isWasteReason(reason: AdjustmentReasonType) {
  return reason === "WASTE" || reason === "SPOILAGE";
}

export function adjustmentDelta(quantity: string, reason: AdjustmentReasonType, direction: AdjustmentDirection) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) throw new Error("수량은 0보다 커야 합니다.");
  return isWasteReason(reason) || direction === "-" ? -q : q;
}

export function filterReceipts(
  receipts: InventoryReceipt[], mode: HistoryFilter, selectedId: string, menuIngredientIds: string[] = [],
) {
  if (mode === "all") return receipts;
  if (!selectedId) return [];
  const ids = new Set(mode === "ingredient" ? [selectedId] : menuIngredientIds);
  return receipts.filter((receipt) => ids.has(receipt.ingredient_id));
}

export function receiptSummary(receipts: InventoryReceipt[], now: number) {
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  const recent = receipts.filter((receipt) => {
    const time = new Date(receipt.received_at).getTime();
    return time >= weekStart && time <= now;
  });
  return {
    latest: receipts.reduce<string | null>((latest, receipt) => (
      latest === null || new Date(receipt.received_at) > new Date(latest) ? receipt.received_at : latest
    ), null),
    count: recent.length,
    amount: recent.reduce((sum, receipt) => sum + Math.round(Number(receipt.total_cost) * 100), 0) / 100,
  };
}

/** 식자재별 최근 입고 단가 대 전체 입고 단가의 단순 평균. */
export function priceChanges(receipts: InventoryReceipt[]) {
  const byIngredient = new Map<string, InventoryReceipt[]>();
  for (const receipt of receipts) {
    const list = byIngredient.get(receipt.ingredient_id) ?? [];
    list.push(receipt);
    byIngredient.set(receipt.ingredient_id, list);
  }
  const rows = [];
  for (const [id, list] of byIngredient) {
    if (list.length < 2) continue;
    const latest = list.reduce((a, b) => new Date(a.received_at) >= new Date(b.received_at) ? a : b);
    const avg = list.reduce((sum, receipt) => sum + Number(receipt.unit_cost_per_base), 0) / list.length;
    if (avg === 0) continue;
    rows.push({ id, name: latest.ingredient_name, percent: ((Number(latest.unit_cost_per_base) - avg) / avg) * 100 });
  }
  return rows.sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent)).slice(0, 3);
}
