import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pagination } from "@astryxdesign/core/Pagination";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { Theme } from "@astryxdesign/core/theme";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import { defaultThemeSlug, themes } from "../astryx-themes";
import { AppLink as Link } from "../components/AppLink";
import { Dialog } from "../components/Dialog";
import { InventoryHistoryDialog } from "../components/InventoryHistoryDialog";
import {
  adjustmentDelta, filterInventory, getInventoryPage, INVENTORY_FILTERS, INVENTORY_PAGE_SIZE,
  isWasteReason, receiptSummary, shortageRanking, type AdjustmentDirection, type InventoryStatusFilter,
} from "../lib/inventoryView";
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

export function ActionDialog({
  store,
  item,
  items,
  onSelect,
  action,
  onClose,
  onDone,
}: {
  store: Store;
  item: IngredientInventoryItem;
  items: IngredientInventoryItem[];
  onSelect: (item: IngredientInventoryItem) => void;
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
  const [direction, setDirection] = useState<AdjustmentDirection>("-");
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
      const delta = adjustmentDelta(quantity, reason, direction);
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

  return (
    <Dialog label={`${item.ingredient_name} ${ACTION_LABELS[action]}`} onClose={onClose}>
      <form onSubmit={submit} className="card inventory-action-dialog w-full max-w-sm space-y-3 shadow-xl">
        <div className="card-head !mb-2">
          <h2>
            {item.ingredient_name} {ACTION_LABELS[action]}
          </h2>
        </div>

        <label className="block text-xs font-medium text-muted">
          식자재
          <select aria-label="식자재" className={`mt-1 ${input}`} value={item.ingredient_id}
            disabled={mutation.isPending}
            onChange={(event) => {
              const selected = items.find((candidate) => candidate.ingredient_id === event.target.value);
              if (selected) onSelect(selected);
            }}>
            {items.map((candidate) => <option key={candidate.ingredient_id} value={candidate.ingredient_id}>{candidate.ingredient_name}</option>)}
          </select>
        </label>

        {action === "ADJUST" && (
          <label className="block text-xs font-medium text-muted">
            보정 사유
            <select aria-label="사유" className={`mt-1 ${input}`} value={reason}
              onChange={(event) => {
                const next = event.target.value as AdjustmentReasonType;
                setReason(next);
                if (isWasteReason(next)) setDirection("-");
              }}>
              {(Object.keys(REASON_LABELS) as AdjustmentReasonType[]).map((r) => (
                <option key={r} value={r}>{REASON_LABELS[r]}</option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-end gap-3">
          {action === "ADJUST" && (
            <SegmentedControl label="보정 방향" value={direction} onChange={(value) => setDirection(value as AdjustmentDirection)}>
              <SegmentedControlItem value="+" label="+" isDisabled={isWasteReason(reason)} />
              <SegmentedControlItem value="-" label="−" />
            </SegmentedControl>
          )}
          <label className="block min-w-0 flex-1 text-xs font-medium text-muted">
            {action === "COUNT" ? "실재고" : "수량"}
            <div className="mt-1 flex gap-2">
              <input
                autoFocus
                aria-label={action === "COUNT" ? "실재고" : "수량"}
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
        </div>

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

        {error && <p role="alert" className="text-xs font-semibold text-[#b42318]">{error}</p>}

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

export function InventoryPage(props: InventoryPageProps) {
  return (
    <Theme theme={themes[defaultThemeSlug]} mode="light">
      <Inventory key={props.store.id} {...props} />
    </Theme>
  );
}

function Inventory({ store }: InventoryPageProps) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<{ item: IngredientInventoryItem; action: Action } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InventoryStatusFilter>("all");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [now] = useState(() => Date.now());
  const filterKey = JSON.stringify([store.id, statusFilter]);
  const [pagination, setPagination] = useState({ filterKey, page: 1 });

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
  const alerts = filterInventory(items, "needs_receipt").length;
  const ranking = shortageRanking(items);
  const summary = receiptSummary(receipts, receiptsQuery.dataUpdatedAt || now);
  const filtered = filterInventory(items, statusFilter);
  const { page, pageCount, offset, rows } = getInventoryPage(filtered, pagination.filterKey === filterKey ? pagination.page : 1);
  if (pagination.filterKey !== filterKey || pagination.page !== page) {
    setPagination({ filterKey, page });
  }
  const summaryReady = !summaryQuery.isLoading && !summaryQuery.isError;
  const receiptsReady = !receiptsQuery.isLoading && !receiptsQuery.isError;

  function openAction(item: IngredientInventoryItem, action: Action) {
    setBanner(null);
    setActive({ item, action });
  }

  function done(text: string) {
    setActive(null);
    setBanner(`${text} 완료`);
    void queryClient.invalidateQueries({ queryKey: ["inventory-summary", store.id] });
    void queryClient.invalidateQueries({ queryKey: ["inventory-receipts", store.id] });
  }

  return (
    <div className="inventory-management">
      <div className="page-heading shrink-0">
        <div className="page-title">
          <h1>입고 · 재고</h1>
          <span className="title-divider" />
          <span className="title-meta">{summaryReady ? items.length : "—"}종</span>
        </div>
        <div className="page-actions">
          <Link to="/ingredients" className="pill pill-secondary">식자재 관리 →</Link>
        </div>
      </div>

      {banner && <div role="status" className="inventory-banner rounded-2xl bg-accent-50 px-4 py-2 text-sm font-semibold text-accent-700">{banner}</div>}

      <div className="inventory-overview">
        <section role="button" tabIndex={0} className="card inventory-alert-card !bg-accent-600 text-white"
          aria-label={`입고 필요 ${summaryReady ? alerts : "—"}종 재고 보기`}
          aria-pressed={statusFilter === "needs_receipt"} onClick={() => setStatusFilter("needs_receipt")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setStatusFilter("needs_receipt");
            }
          }}>
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">입고 필요</span>
            <strong className="text-3xl font-semibold tabular-nums">{summaryReady ? alerts : "—"}<small className="ml-1 text-sm font-normal">종</small></strong>
          </span>
          <span className="text-xs">안전재고 대비 부족률 순</span>
          {summaryReady && ranking.length > 0 ? (
            <ol className="flex flex-col gap-1 text-sm">
              {ranking.map(({ item, shortage }) => (
                <li key={item.ingredient_id} className="flex items-center justify-between gap-3">
                  <span className="truncate">{item.ingredient_name}</span>
                  <span className="shrink-0 tabular-nums">{(shortage * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ol>
          ) : <span className="text-sm">{summaryQuery.isError ? "재고 조회 실패" : !summaryReady ? "재고 확인 중" : alerts === 0 ? "입고 필요한 식자재가 없습니다" : "부족률을 계산할 식자재가 없습니다"}</span>}
        </section>

        <section className="card inventory-quick-card" aria-label="재고 빠른 기록">
          <h2 className="text-sm font-semibold">빠른 기록</h2>
          <div className="grid grid-cols-3 gap-2">
            {(["RECEIPT", "ADJUST", "COUNT"] as Action[]).map((action) => (
              <button type="button" key={action} disabled={!summaryReady || items.length === 0}
                className={`pill inventory-quick-action ${action === "RECEIPT" ? "pill-dark" : "pill-soft"}`}
                onClick={() => openAction(items[0], action)}>
                {action === "RECEIPT" ? "입고 등록" : action === "COUNT" ? "실사 입력" : ACTION_LABELS[action]}
              </button>
            ))}
          </div>
          <dl className="inventory-receipt-summary">
            <div><dt>최근 입고일</dt><dd>{!receiptsReady ? "—" : summary.latest ? new Date(summary.latest).toLocaleDateString("ko-KR", { timeZone: store.timezone }) : "없음"}</dd></div>
            <div><dt>최근 7일 입고</dt><dd>{receiptsReady ? `${fmt(summary.count)}건` : "—"}</dd></div>
            <div><dt>최근 7일 입고액</dt><dd>{receiptsReady ? `${fmt(summary.amount)}원` : "—"}</dd></div>
          </dl>
          {receiptsQuery.isError && <p role="alert" className="text-xs text-muted">{errorText(receiptsQuery.error, "입고 이력을 불러오지 못했습니다.")}</p>}
        </section>
      </div>

      <section className="card inventory-list" aria-label="재고 현황">
        <div className="card-head !mb-0 shrink-0">
          <h2>재고 현황</h2>
          <button type="button" className="pill pill-sm pill-soft" onClick={() => setHistoryOpen(true)}>입고 · 단가 이력 &gt;</button>
        </div>
        <div className="inventory-toolbar">
          <SegmentedControl label="재고 상태" value={statusFilter} onChange={(value) => setStatusFilter(value as InventoryStatusFilter)}>
            {INVENTORY_FILTERS.map((filter) => <SegmentedControlItem key={filter.value} value={filter.value} label={filter.label} />)}
          </SegmentedControl>
        </div>
        <div key={`${filterKey}:${page}`} className="inventory-table-region" role="region" aria-label="재고 현황 표" tabIndex={0} aria-busy={summaryQuery.isLoading}>
          {summaryQuery.isLoading ? <p role="status" className="p-4 text-sm text-muted">재고를 불러오는 중입니다...</p>
            : summaryQuery.isError ? <p role="alert" className="p-4 text-sm text-muted">{errorText(summaryQuery.error, "재고를 불러오지 못했습니다.")}</p>
            : items.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm text-muted">등록된 식자재가 없습니다</p>
                <Link to="/ingredients" className="pill pill-primary mt-4">식자재 추가</Link>
              </div>
            ) : rows.length === 0 ? <p role="status" className="p-4 text-sm text-muted">조건에 맞는 식자재가 없습니다.</p> : (
              <table className="data-table inventory-table">
                <thead><tr>
                  <th>식자재</th><th className="!text-right">최근 입고 단가</th><th className="!text-right">마지막 실사</th>
                  <th className="!text-right">실사 후 입고</th><th className="!text-right">실사 후 소모</th>
                  <th className="!text-right">실사 후 폐기·보정</th><th className="!text-right">예상 재고</th><th>상태</th>
                  <th className="!text-right"><span className="sr-only">기록</span></th>
                </tr></thead>
                <tbody>{rows.map((item) => {
                  const u = unitLabel(item.base_unit);
                  const status = STATUS[item.stock_status];
                  const countDate = item.last_counted_at ? new Date(item.last_counted_at).toLocaleDateString("ko-KR", { timeZone: store.timezone }) : null;
                  return (
                    <tr key={item.ingredient_id}>
                      <td className="font-semibold">{item.ingredient_name}</td>
                      <td className="!text-right tabular-nums">{item.latest_unit_cost_per_purchase === null ? "-" : `${fmt(item.latest_unit_cost_per_purchase)}원/${unitLabel(item.purchase_unit)}`}</td>
                      <td className="!text-right tabular-nums">
                        <div className="inventory-count-value">
                          <span>{item.last_actual_quantity === null ? "없음" : `${fmt(item.last_actual_quantity)}${u}`}</span>
                          {item.last_actual_quantity !== null && countDate ? (
                            <Tooltip content={`최근 실사: ${countDate}`} touchTrigger="tap" focusTrigger="always" hasHoverIndication={false}>
                              <button type="button" className="inventory-info-button" aria-label={`${item.ingredient_name} 최근 실사: ${countDate}`}>ⓘ</button>
                            </Tooltip>
                          ) : <span className="inventory-info-placeholder" aria-hidden="true" />}
                        </div>
                      </td>
                      <td className="!text-right font-medium text-accent-700 tabular-nums">+{fmt(item.receipts_since_count_base)}{u}</td>
                      <td className="!text-right text-muted tabular-nums">-{fmt(item.theoretical_consumption_base)}{u}</td>
                      <td className="!text-right text-muted tabular-nums">{fmt(item.adjustments_since_count_base)}{u}</td>
                      <td className="!text-right font-semibold tabular-nums">{fmt(item.estimated_quantity)}{u}</td>
                      <td><span className={`chip ${status.className}`}>{status.label}</span></td>
                      <td className="!text-right"><div className="flex justify-end gap-1.5">
                        {(Object.keys(ACTION_LABELS) as Action[]).map((action) => (
                          <button key={action} type="button" onClick={() => openAction(item, action)}
                            className={`pill pill-sm ${action === "RECEIPT" ? "pill-dark" : "pill-soft"}`}>{ACTION_LABELS[action]}</button>
                        ))}
                      </div></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-rule pt-3 text-xs text-muted tabular-nums">
          <p role="status" aria-live="polite">{summaryReady ? `${filtered.length > 0 ? `${offset + 1}–${offset + rows.length}` : "0"} / ${filtered.length}종 · 페이지당 ${INVENTORY_PAGE_SIZE}행` : "—"}</p>
          <Pagination label="재고 목록 페이지" page={page} totalPages={pageCount} size="sm" variant="compact"
            isDisabled={!summaryReady || filtered.length === 0} onChange={(next) => setPagination({ filterKey, page: next })} />
        </footer>
      </section>

      {active && <ActionDialog key={`${active.item.ingredient_id}:${active.action}`} store={store} item={active.item} items={items}
        action={active.action} onSelect={(item) => setActive({ item, action: active.action })} onClose={() => setActive(null)} onDone={done} />}
      {historyOpen && <InventoryHistoryDialog store={store} receipts={receipts} isLoading={receiptsQuery.isLoading}
        error={receiptsQuery.error} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
