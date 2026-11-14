import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { fetchMenus } from "../api/menus";
import { fetchMenuRecipe } from "../api/ingredients";
import { Dialog } from "./Dialog";
import { filterReceipts, priceChanges, type HistoryFilter } from "../lib/inventoryView";
import type { InventoryReceipt, Store } from "../types";

const fmt = (value: string | number) => Number(value).toLocaleString("ko-KR");
const unitLabel = (unit: string) => unit === "ea" ? "개" : unit;

export function InventoryHistoryDialog({ store, receipts, isLoading, error, onClose }: {
  store: Store;
  receipts: InventoryReceipt[];
  isLoading: boolean;
  error: Error | null;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<HistoryFilter>("all");
  const [ingredientId, setIngredientId] = useState("");
  const [menuId, setMenuId] = useState("");
  const menusQuery = useQuery({
    queryKey: ["menus", store.id, "inventory-history"],
    queryFn: () => fetchMenus(store.id, { status: "all" }),
    enabled: mode === "menu",
  });
  const recipeQuery = useQuery({
    queryKey: ["menu-recipe", store.id, menuId],
    queryFn: () => fetchMenuRecipe(store.id, menuId),
    enabled: mode === "menu" && Boolean(menuId),
  });
  const ingredientOptions = Array.from(new Map(receipts.map((r) => [r.ingredient_id, r.ingredient_name])))
    .sort((a, b) => a[1].localeCompare(b[1], "ko"));
  const rows = filterReceipts(receipts, mode, mode === "ingredient" ? ingredientId : menuId,
    recipeQuery.data?.items.map((item) => item.ingredient_id));
  const changes = priceChanges(rows);
  const filterLoading = mode === "menu" && (menusQuery.isLoading || (Boolean(menuId) && recipeQuery.isLoading));
  const filterError = mode === "menu" ? menusQuery.error ?? (menuId ? recipeQuery.error : null) : null;
  const message = isLoading || filterLoading ? "이력을 불러오는 중입니다..."
    : error || filterError ? (error ?? filterError)!.message
    : mode === "ingredient" && !ingredientId ? "식자재를 선택해 주세요."
    : mode === "menu" && !menuId ? "메뉴를 선택해 주세요."
    : mode === "menu" && recipeQuery.data?.items.length === 0 ? "연결된 식자재가 없습니다."
    : rows.length === 0 ? "입고 기록이 없습니다" : null;

  return (
    <Dialog label="입고 · 단가 이력" onClose={onClose}>
      <section className="card inventory-history-dialog" aria-label="입고 · 단가 이력 목록">
        <div className="card-head !mb-0 shrink-0">
          <h2>입고 · 단가 이력</h2>
          <button type="button" className="pill pill-sm pill-soft" onClick={onClose}>닫기</button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <SegmentedControl label="이력 필터" value={mode} onChange={(value) => setMode(value as HistoryFilter)}>
            <SegmentedControlItem value="all" label="전체" />
            <SegmentedControlItem value="ingredient" label="식자재별" />
            <SegmentedControlItem value="menu" label="메뉴별" />
          </SegmentedControl>
          {mode === "ingredient" && (
            <select aria-label="이력 식자재" className="inventory-select" value={ingredientId}
              onChange={(event) => setIngredientId(event.target.value)}>
              <option value="">식자재 선택</option>
              {ingredientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
          {mode === "menu" && (
            <select aria-label="이력 메뉴" className="inventory-select" value={menuId}
              disabled={menusQuery.isLoading || menusQuery.isError}
              onChange={(event) => setMenuId(event.target.value)}>
              <option value="">메뉴 선택</option>
              {(menusQuery.data ?? []).map((menu) => <option key={menu.id} value={menu.id}>{menu.name}</option>)}
            </select>
          )}
        </div>
        {!message && changes.length > 0 && (
          <section className="shrink-0" aria-label="단가 변동">
            <h3 className="mb-2 text-xs text-muted">단가 변동 (최근 입고 대 평균)</h3>
            <ol className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {changes.map((change) => (
                <li key={change.id} className="flex gap-2">
                  <span>{change.name}</span>
                  <span className="font-semibold tabular-nums">
                    {change.percent > 0 ? "▲" : change.percent < 0 ? "▼" : ""} {Math.abs(change.percent).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className="inventory-history-scroll" role="region" aria-label="입고 이력 표" tabIndex={0}
          aria-busy={isLoading || filterLoading}>
          {message ? <p className="p-4 text-sm text-muted" role={error || filterError ? "alert" : "status"}>{message}</p> : (
            <table className="data-table">
              <thead><tr>
                <th>입고 일시</th><th>식자재</th><th className="!text-right">수량</th>
                <th className="!text-right">금액</th><th className="!text-right">단가</th><th>공급처</th>
              </tr></thead>
              <tbody>{rows.map((receipt) => (
                <tr key={receipt.id}>
                  <td className="text-muted tabular-nums">{new Date(receipt.received_at).toLocaleString("ko-KR", { timeZone: store.timezone })}</td>
                  <td className="font-semibold">{receipt.ingredient_name}</td>
                  <td className="!text-right tabular-nums">{fmt(receipt.purchase_quantity)}{unitLabel(receipt.purchase_unit)}</td>
                  <td className="!text-right tabular-nums">{fmt(receipt.total_cost)}원</td>
                  <td className="!text-right tabular-nums">{fmt(receipt.unit_cost_per_purchase)}원/{unitLabel(receipt.purchase_unit)}</td>
                  <td className="text-muted">{receipt.supplier_name ?? "-"}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <p className="shrink-0 text-xs text-muted tabular-nums" role="status">{message ? "—" : rows.length}건</p>
      </section>
    </Dialog>
  );
}
