import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@astryxdesign/core/Button";
import { Dialog as AstryxDialog } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Pagination } from "@astryxdesign/core/Pagination";
import { InternationalizationProvider } from "@astryxdesign/core/i18n";
import koKR from "@astryxdesign/core/locales/ko-KR.generated.js";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { Theme } from "@astryxdesign/core/theme";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import { defaultThemeSlug, themes } from "../astryx-themes";
import {
  createIngredient,
  fetchIngredients,
  updateIngredient,
} from "../api/ingredients";
import { createAdjustment, fetchInventorySummary } from "../api/inventory";
import { AppLink as Link } from "../components/AppLink";
import { Dialog } from "../components/Dialog";
import { Skeleton, SkeletonTable } from "../components/Skeleton";
import {
  computeIngredientKpi,
  getEstimatedTickPercent,
  getSafetySliderSpec,
  matchesIngredientCheckCondition,
  type IngredientCheckCondition,
  type IngredientUiStatus,
} from "../lib/ingredientKpi";
import { useAnimatedNumber } from "../lib/useAnimatedNumber";
import { useUrlState } from "../lib/useUrlState";
import { ActionDialog } from "./InventoryPage";
import type {
  AdjustmentReasonType,
  Ingredient,
  IngredientInventoryItem,
  IngredientRankItem,
  PurchaseUnitType,
  Store,
} from "../types";

type Filter = "all" | "NEEDS_RESTOCK" | "OUT_OF_STOCK" | "IDLE" | "IN_USE";
const FILTERS: readonly Filter[] = ["all", "NEEDS_RESTOCK", "OUT_OF_STOCK", "IDLE", "IN_USE"];

type CheckParam = "" | IngredientCheckCondition;
const CHECK_VALUES: readonly CheckParam[] = ["", "unlinked", "no_cost"];

const CHECK_LABELS: Record<IngredientCheckCondition, string> = {
  unlinked: "레시피 미연결",
  no_cost: "단가 미입력",
};

const UI_STATUS_BADGE: Record<IngredientUiStatus, { label: string; className: string }> = {
  OK: { label: "충분", className: "chip-ok" },
  NEEDS_RESTOCK: { label: "입고 필요", className: "chip-warn" },
  OUT_OF_STOCK: { label: "재고 없음", className: "chip-danger" },
  IDLE: { label: "미사용", className: "chip-idle" },
};

const UNITS: PurchaseUnitType[] = ["kg", "g", "L", "ml", "ea"];
const unitLabel = (u: string) => (u === "ea" ? "개" : u);
const fmt = (v: string | number) => Number(v).toLocaleString("ko-KR");

type Row = Ingredient & { no: number } & Record<string, unknown>;

const PAGE_SIZE = 20;

export function getIngredientPage(ingredients: Ingredient[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(ingredients.length / PAGE_SIZE));
  const page = Math.max(
    1,
    Math.min(pageCount, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1),
  );
  const offset = (page - 1) * PAGE_SIZE;
  const rows: Row[] = ingredients.slice(offset, offset + PAGE_SIZE).map((ing, index) => ({
    ...ing,
    no: offset + index + 1,
  }));
  return { page, pageCount, offset, rows };
}

export interface RestockUrgentItem {
  ingredient_id: string;
  name: string;
  unit: string;
  safety_stock: number;
  estimated_quantity: number;
  shortage_amount: number;
  shortage_ratio: number;
}

export function getTopRestockIngredients(
  ingredients: Ingredient[],
  inventorySummary: IngredientInventoryItem[] = [],
  recentUsage: IngredientRankItem[] = [],
): RestockUrgentItem[] {
  const summaryById = new Map(inventorySummary.map((item) => [item.ingredient_id, item]));
  const usageById = new Map(recentUsage.map((item) => [item.ingredient_id, Number(item.value)]));
  const candidates = ingredients.filter((item) => item.stock_status === "NEEDS_RESTOCK");

  return candidates
    .map((item) => {
      const inv = summaryById.get(item.id);
      const safety = Math.max(0, Number(item.safety_stock ?? inv?.safety_stock ?? 0));
      const estimated = inv !== undefined ? Number(inv.estimated_quantity) : 0;
      const shortageAmount = safety - estimated;
      const shortageRatio = safety > 0 ? shortageAmount / safety : shortageAmount > 0 ? 1 : 0;
      const usage = usageById.get(item.id) ?? 0;
      return {
        ingredient_id: item.id,
        name: item.name,
        unit: item.base_unit,
        safety_stock: safety,
        estimated_quantity: estimated,
        shortage_amount: shortageAmount,
        shortage_ratio: shortageRatio,
        usage,
        linked_menu_count: item.linked_menu_count,
      };
    })
    .sort((a, b) => {
      if (b.shortage_ratio !== a.shortage_ratio) return b.shortage_ratio - a.shortage_ratio;
      if (b.shortage_amount !== a.shortage_amount) return b.shortage_amount - a.shortage_amount;
      if (b.safety_stock !== a.safety_stock) return b.safety_stock - a.safety_stock;
      if (b.usage !== a.usage) return b.usage - a.usage;
      if (b.linked_menu_count !== a.linked_menu_count) {
        return b.linked_menu_count - a.linked_menu_count;
      }
      return a.name.localeCompare(b.name, "ko-KR");
    })
    .slice(0, 3)
    .map((it) => ({
      ingredient_id: it.ingredient_id,
      name: it.name,
      unit: it.unit,
      safety_stock: it.safety_stock,
      estimated_quantity: it.estimated_quantity,
      shortage_amount: it.shortage_amount,
      shortage_ratio: it.shortage_ratio,
    }));
}

function SafetyStockSlider({
  ingredient,
  estimatedQuantity,
  onCommit,
}: {
  ingredient: Ingredient;
  estimatedQuantity: number | null;
  onCommit: (nextSafety: number) => Promise<void>;
}) {
  const serverSafety =
    ingredient.safety_stock !== null && ingredient.safety_stock !== undefined
      ? Math.max(0, Number(ingredient.safety_stock))
      : 0;
  const [sessionBase] = useState<number>(() => serverSafety);
  const { max, step } = getSafetySliderSpec(sessionBase, ingredient.base_unit);

  const [draft, setDraft] = useState<number>(serverSafety);
  const [lastKnownServer, setLastKnownServer] = useState<number>(serverSafety);
  if (lastKnownServer !== serverSafety) {
    setLastKnownServer(serverSafety);
    setDraft(serverSafety);
  }

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleSave = (nextVal: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (nextVal === serverSafety) return;
      void onCommit(nextVal).catch(() => {
        setDraft(serverSafety);
      });
    }, 250);
  };

  const tickPercent = getEstimatedTickPercent(estimatedQuantity, max);

  // 슬라이더를 움직이면 숫자가 목표값까지 부드럽게 따라간다(약 180ms, ease-out)
  const [shown, setShown] = useState<number>(draft);
  const shownRef = useRef(draft);
  useEffect(() => {
    const from = shownRef.current;
    if (from === draft || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      shownRef.current = draft;
      setShown(draft);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 180);
      const v = from + (draft - from) * (1 - (1 - p) ** 3);
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draft]);

  return (
    <div className="ing-safety-slider">
      <span className="ing-safety-val">
        {fmt(Math.round(shown))}
        {unitLabel(ingredient.base_unit)}
      </span>
      <span className="ing-safety-track-wrap">
        <input
          type="range"
          className="ing-safety-range"
          aria-label={`${ingredient.name} 안전재고`}
          min={0}
          max={max}
          step={step}
          value={Math.min(max, draft)}
          onChange={(e) => {
            const next = Number(e.target.value);
            setDraft(next);
            scheduleSave(next);
          }}
          onPointerUp={(e) => {
            const next = Number((e.currentTarget as HTMLInputElement).value);
            scheduleSave(next);
          }}
        />
        {tickPercent !== null && (
          <b
            className="ing-est-tick"
            style={{ left: `${tickPercent}%` }}
            title={`예상 재고 ${fmt(estimatedQuantity!)}${unitLabel(ingredient.base_unit)}`}
          />
        )}
      </span>
    </div>
  );
}

function StockAdjustmentModal({
  store,
  ingredient,
  onClose,
  onSaved,
}: {
  store: Store;
  ingredient: Ingredient;
  onClose: () => void;
  onSaved: (summaryText: string) => void;
}) {
  const [reason, setReason] = useState<"WASTE" | "CORRECTION">("WASTE");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const q = Number(quantity);
      if (!Number.isFinite(q) || q <= 0) {
        throw new Error("차감할 수량을 0보다 크게 입력해 주세요.");
      }
      const trimmedNotes = notes.trim().slice(0, 200) || null;
      const reasonType: AdjustmentReasonType = reason;
      await createAdjustment(store.id, {
        ingredient_id: ingredient.id,
        quantity_delta: -Math.abs(q),
        reason: reasonType,
        notes: trimmedNotes,
      });
      const reasonLabel = reason === "WASTE" ? "폐기" : "재고 보정";
      return `${ingredient.name} ${reasonLabel} -${fmt(q)}${unitLabel(ingredient.base_unit)}`;
    },
    onSuccess: (summaryText) => {
      onSaved(summaryText);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error && err.message ? err.message : "재고 수정에 실패했습니다.");
    },
  });

  const placeholderText =
    reason === "WASTE" ? "예: 잘못 만들어 폐기, 유통기한 경과" : "예: 정량 초과 사용, 실사 차이 보정";

  return (
    <Dialog label={`${ingredient.name} 재고 수정`} onClose={onClose}>
      <form
        className="ing-adjust-modal"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        <div className="kpi-modal-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{ingredient.name} 재고 수정</h2>
            <p style={{ fontSize: 12, color: "#636d81", margin: "2px 0 0" }}>
              폐기 또는 보정으로 차감할 수량을 기록합니다
            </p>
          </div>
          <button type="button" className="pill pill-sm pill-soft" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <span className="block text-xs font-medium text-muted">사유 선택</span>
            <div className="ing-adjust-reasons mt-1" role="radiogroup" aria-label="재고 수정 사유">
              <button
                type="button"
                role="radio"
                aria-checked={reason === "WASTE"}
                className={`ing-adjust-reason-btn${reason === "WASTE" ? " is-on" : ""}`}
                onClick={() => setReason("WASTE")}
              >
                폐기
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={reason === "CORRECTION"}
                className={`ing-adjust-reason-btn${reason === "CORRECTION" ? " is-on" : ""}`}
                onClick={() => setReason("CORRECTION")}
              >
                재고 보정
              </button>
            </div>
          </div>

          <label className="block text-xs font-medium text-muted">
            감소 수량
            <div className="mt-1 flex items-center gap-2">
              <input
                autoFocus
                aria-label="감소 수량"
                inputMode="decimal"
                placeholder="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="h-10 w-full rounded-xl bg-ground px-3 text-sm text-ink tabular-nums"
              />
              <span className="shrink-0 text-sm font-semibold text-muted">
                {unitLabel(ingredient.base_unit)}
              </span>
            </div>
          </label>

          <label className="block text-xs font-medium text-muted">
            메모 (선택, 최대 200자)
            <input
              type="text"
              aria-label="재고 수정 메모"
              maxLength={200}
              placeholder={placeholderText}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl bg-ground px-3 text-sm text-ink"
            />
          </label>

          {error && (
            <p role="alert" className="text-xs font-semibold text-[#b42318]">
              {error}
            </p>
          )}

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
        </div>
      </form>
    </Dialog>
  );
}

type Props = { store: Store };

export function IngredientManagementPage(props: Props) {
  return (
    <Theme theme={themes[defaultThemeSlug]} mode="light">
      <IngredientManagement {...props} />
    </Theme>
  );
}

type FormState = {
  id: string | null;
  name: string;
  safety: number | null;
  unit: PurchaseUnitType;
  notes: string;
};

const EMPTY_FORM: FormState = { id: null, name: "", safety: null, unit: "g", notes: "" };

function toFallbackInventoryItem(ing: Ingredient): IngredientInventoryItem {
  return {
    ingredient_id: ing.id,
    ingredient_name: ing.name,
    is_active: ing.is_active,
    base_unit: ing.base_unit,
    purchase_unit: ing.purchase_unit,
    conversion_factor: ing.conversion_factor,
    safety_stock: ing.safety_stock,
    latest_unit_cost_per_purchase: null,
    latest_unit_cost_per_base: null,
    cost_basis_label: "",
    last_actual_quantity: null,
    last_counted_at: null,
    receipts_since_count_base: "0.000",
    theoretical_consumption_base: "0.000",
    adjustments_since_count_base: "0.000",
    estimated_quantity: "0.000",
    stock_status: "OK",
  };
}

function IngredientManagement({ store }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useUrlState<Filter>("status", "all", FILTERS);
  const [checkFilter, setCheckFilter] = useUrlState<CheckParam>("check", "", CHECK_VALUES);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [valuationModalOpen, setValuationModalOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<Ingredient | null>(null);
  const [inventoryAction, setInventoryAction] = useState<{
    item: IngredientInventoryItem;
    action: "RECEIPT" | "COUNT";
  } | null>(null);
  const keyword = q.trim().toLowerCase();
  const filterKey = JSON.stringify([store.id, filter, checkFilter, keyword]);
  const [pagination, setPagination] = useState({ filterKey, page: 1 });

  const listQuery = useQuery({
    queryKey: ["ingredients", store.id, "all"],
    queryFn: () => fetchIngredients(store.id, { status: "all" }),
  });
  const inventorySummaryQuery = useQuery({
    queryKey: ["inventory-summary", store.id, "active"],
    queryFn: () => fetchInventorySummary(store.id, false),
  });

  const refresh = () => {
    for (const key of ["ingredients", "inventory-summary", "menus", "menu-costs"]) {
      void queryClient.invalidateQueries({ queryKey: [key, store.id] });
    }
  };
  const fail = (err: unknown, fallback: string) =>
    toast({ body: err instanceof Error && err.message ? err.message : fallback, type: "error" });

  const saveMutation = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        name: f.name.trim(),
        unit: f.unit,
        safety_stock: f.safety,
        notes: f.notes.trim() || null,
      };
      return f.id
        ? updateIngredient(store.id, f.id, body)
        : createIngredient(store.id, { ...body, is_active: true });
    },
    onSuccess: (_, f) => {
      toast({ body: f.id ? "수정했습니다" : "추가했습니다", type: "info" });
      setForm(null);
      refresh();
    },
    onError: (err) => fail(err, "저장하지 못했습니다"),
  });

  const safetyMutation = useMutation({
    mutationFn: ({ id, safety_stock }: { id: string; safety_stock: number }) =>
      updateIngredient(store.id, id, { safety_stock }),
    // 상태(부족/충분)를 바로 바꾸려고 목록 캐시를 먼저 고치고, 실패하면 되돌린다
    onMutate: async ({ id, safety_stock }) => {
      const key = ["ingredients", store.id, "all"];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Ingredient[]>(key);
      queryClient.setQueryData<Ingredient[]>(key, (list) =>
        list?.map((i) => (i.id === id ? { ...i, safety_stock: String(safety_stock) } : i))
      );
      return { previous };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["ingredients", store.id] });
    },
    onError: (err, _v, context) => {
      if (context?.previous) queryClient.setQueryData(["ingredients", store.id, "all"], context.previous);
      fail(err, "안전재고를 저장하지 못했습니다");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      updateIngredient(store.id, id, { is_active: on }),
    onSuccess: refresh,
    onError: (err) => fail(err, "변경하지 못했습니다"),
  });

  const all = listQuery.data ?? [];
  const summaryList = inventorySummaryQuery.data ?? [];
  const kpi = computeIngredientKpi(all, summaryList, store.timezone);
  const enrichedById = new Map(kpi.rows.map((r) => [r.ingredient.id, r]));

  const listLoading = listQuery.isLoading;
  const summaryLoading = inventorySummaryQuery.isLoading;
  const kpiLoading = listLoading || summaryLoading;

  const animEvalManWon = useAnimatedNumber(kpiLoading ? null : Number(kpi.totalEvaluationManWon));
  const animSufficient = useAnimatedNumber(kpiLoading ? null : kpi.sufficientCount);
  const animNeedsRestock = useAnimatedNumber(kpiLoading ? null : kpi.needsRestockCount);
  const animOutOfStock = useAnimatedNumber(kpiLoading ? null : kpi.outOfStockCount);
  const animNeedsCheck = useAnimatedNumber(kpiLoading ? null : kpi.needsCheckCount);
  const animUnlinked = useAnimatedNumber(kpiLoading ? null : kpi.unlinkedCount);
  const animNoCost = useAnimatedNumber(kpiLoading ? null : kpi.noCostCount);

  function selectStatusTab(next: Filter) {
    setFilter(next);
    if (checkFilter) {
      setCheckFilter("");
    }
  }

  function selectCheckRow(condition: IngredientCheckCondition) {
    if (checkFilter === condition) {
      setCheckFilter("");
      return;
    }
    setFilter("all");
    setCheckFilter(condition);
  }

  const sortedIngredients = kpi.rows.map((r) => r.ingredient);
  const filteredIngredients = sortedIngredients
    .filter((ing) => {
      const row = enrichedById.get(ing.id);
      if (checkFilter) {
        return matchesIngredientCheckCondition(row, checkFilter);
      }
      if (filter === "all") return true;
      if (filter === "OUT_OF_STOCK") return row?.uiStatus === "OUT_OF_STOCK";
      if (filter === "NEEDS_RESTOCK") {
        return row?.uiStatus === "NEEDS_RESTOCK" || ing.stock_status === "NEEDS_RESTOCK";
      }
      if (filter === "IDLE") {
        return row?.uiStatus === "IDLE" || ing.stock_status === "IDLE";
      }
      return ing.stock_status === filter;
    })
    .filter((i) => !keyword || i.name.toLowerCase().includes(keyword));

  const { page, pageCount, offset, rows } = getIngredientPage(
    filteredIngredients,
    pagination.filterKey === filterKey ? pagination.page : 1,
  );
  if (pagination.filterKey !== filterKey || pagination.page !== page) {
    setPagination({ filterKey, page });
  }

  const allInventoryItems: IngredientInventoryItem[] =
    summaryList.length > 0 ? summaryList : all.map(toFallbackInventoryItem);

  function openInventoryAction(action: "RECEIPT" | "COUNT", targetIng?: Ingredient) {
    const targetId = targetIng?.id ?? all[0]?.id;
    if (!targetId) return;
    const found =
      allInventoryItems.find((it) => it.ingredient_id === targetId) ??
      (targetIng ? toFallbackInventoryItem(targetIng) : allInventoryItems[0]);
    if (found) {
      setInventoryAction({ item: found, action });
    }
  }

  function openEditForm(ing: Ingredient) {
    setForm({
      id: ing.id,
      name: ing.name,
      safety: ing.safety_stock === null ? null : Number(ing.safety_stock),
      unit: ing.base_unit,
      notes: ing.notes ?? "",
    });
  }

  return (
    <div className="ingredient-management kpi-page">
      <h1 className="kpi-title">
        식자재 관리{" "}
        <small>
          {kpiLoading ? (
            <Skeleton width={148} height={14} variant="text" />
          ) : (
            <>
              {kpi.totalCount}개 ·{" "}
              {kpi.lastCountedLabel ? `마지막 실사 ${kpi.lastCountedLabel}` : "실사 기록 없음"}
            </>
          )}
        </small>
      </h1>

      <section className="kpi-grid" aria-label="식자재 핵심 지표">
        {/* 1. 대표 숫자: 재고 평가금액 (그라데이션 1개) */}
        <article className="kpi-card">
          <div className="kpi-head">
            <b>재고 평가금액</b>
            <div className="kpi-head-right">
              <span>예상 재고 × 최근 입고 단가</span>
              <button
                type="button"
                className="kpi-head-action"
                disabled={kpiLoading || kpi.allValuationItems.length === 0}
                onClick={() => setValuationModalOpen(true)}
              >
                전체 보기 →
              </button>
            </div>
          </div>
          {kpiLoading ? (
            <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label="재고 평가금액 불러오는 중">
              <div className="kpi-big">
                <Skeleton width={140} height={36} />
              </div>
              <Skeleton width="100%" height={12} radius={6} />
              <div className="kpi-rows">
                {[0, 1, 2].map((idx) => (
                  <div key={idx} className="kpi-row">
                    <Skeleton width={96} height={14} variant="text" />
                    <Skeleton width={82} height={14} variant="text" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="kpi-big kpi-grad">
                {(animEvalManWon ?? Number(kpi.totalEvaluationManWon)).toFixed(1)}
                <em>만원</em>
              </div>
              <div className="kpi-stack" aria-label="식자재별 평가금액 비중">
                {kpi.valuationSegments.map((seg) => (
                  <i key={seg.id} style={{ flex: seg.flex, background: seg.colorVar }} />
                ))}
              </div>
              <div className="kpi-rows">
                {kpi.valuationRows.length === 0 ? (
                  <div className="kpi-row">
                    <span className="l">입고 단가가 입력된 식자재 없음</span>
                    <span className="v kpi-na">미산출</span>
                  </div>
                ) : (
                  kpi.valuationRows.map((row) => (
                    <div key={row.id} className="kpi-row">
                      <span className="l">
                        <i style={{ background: row.colorVar }} />
                        {row.label}
                      </span>
                      <span className="v">
                        {row.amountWon.toLocaleString("ko-KR")}원
                        <small>{row.roundedSharePercent}%</small>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </article>

        {/* 2. 재고 상태: 구간 막대 + 값 행 */}
        <article className="kpi-card">
          <div className="kpi-head">
            <b>재고 상태</b>
            <span>안전재고 기준</span>
          </div>
          {kpiLoading ? (
            <div className="flex flex-1 flex-col gap-3" role="status" aria-busy="true" aria-label="재고 상태 불러오는 중">
              <Skeleton width="100%" height={28} radius={6} />
              <div className="kpi-rows">
                {[
                  { color: "var(--kpi-c2)", label: "충분" },
                  { color: "#f5b301", label: "입고 필요" },
                  { color: "var(--kpi-warn)", label: "재고 없음" },
                ].map((item) => (
                  <div key={item.label} className="kpi-row">
                    <span className="l">
                      <i style={{ background: item.color }} />
                      {item.label}
                    </span>
                    <Skeleton width={32} height={14} variant="text" />
                  </div>
                ))}
              </div>
              <div className="kpi-foot kpi-foot-end">
                <Skeleton width={76} height={14} variant="text" />
              </div>
            </div>
          ) : (
            <>
              <div className="kpi-seg" aria-label="상태별 식자재 수">
                {kpi.sufficientCount > 0 && (
                  <i style={{ flex: kpi.sufficientCount, background: "var(--kpi-c2)" }}>
                    충분 {Math.round(animSufficient ?? kpi.sufficientCount)}
                  </i>
                )}
                {kpi.needsRestockCount > 0 && (
                  <i style={{ flex: kpi.needsRestockCount, background: "#f5b301" }}>
                    입고 필요 {Math.round(animNeedsRestock ?? kpi.needsRestockCount)}
                  </i>
                )}
                {kpi.outOfStockCount > 0 && (
                  <i style={{ flex: kpi.outOfStockCount, background: "var(--kpi-warn)" }}>
                    재고 없음 {Math.round(animOutOfStock ?? kpi.outOfStockCount)}
                  </i>
                )}
                {kpi.totalCount === 0 && (
                  <i style={{ flex: 1, background: "var(--kpi-c5)" }}>식자재 0</i>
                )}
              </div>
              <div className="kpi-rows">
                <div className="kpi-row">
                  <span className="l">
                    <i style={{ background: "var(--kpi-c2)" }} />
                    충분
                  </span>
                  <span className="v">{Math.round(animSufficient ?? kpi.sufficientCount)}개</span>
                </div>
                <div className="kpi-row">
                  <span className="l">
                    <i style={{ background: "#f5b301" }} />
                    입고 필요
                  </span>
                  <span className={`v${kpi.needsRestockCount > 0 ? " w" : ""}`}>
                    {Math.round(animNeedsRestock ?? kpi.needsRestockCount)}개
                  </span>
                </div>
                <div className="kpi-row">
                  <span className="l">
                    <i style={{ background: "var(--kpi-warn)" }} />
                    재고 없음
                  </span>
                  <span className={`v${kpi.outOfStockCount > 0 ? " w" : ""}`}>
                    {Math.round(animOutOfStock ?? kpi.outOfStockCount)}개
                  </span>
                </div>
              </div>
              <div className="kpi-foot kpi-foot-end">
                <button
                  type="button"
                  disabled={all.length === 0}
                  onClick={() => openInventoryAction("RECEIPT")}
                >
                  입고 등록 →
                </button>
              </div>
            </>
          )}
        </article>

        {/* 3. 확인 필요 */}
        <article className="kpi-card kpi-check">
          <div className="kpi-head">
            <b>확인 필요</b>
            <span>
              {kpiLoading ? (
                <Skeleton width={28} height={14} variant="text" />
              ) : (
                `${Math.round(animNeedsCheck ?? kpi.needsCheckCount)}건`
              )}
            </span>
          </div>
          {kpiLoading ? (
            <div className="flex flex-1 flex-col gap-2" role="status" aria-busy="true" aria-label="확인 필요 항목 불러오는 중">
              <div className="kpi-rows">
                {[
                  { color: "#f5b301", label: "레시피 미연결" },
                  { color: "var(--kpi-c5)", label: "단가 미입력" },
                ].map((item) => (
                  <div key={item.label} className="kpi-row">
                    <span className="l">
                      <i style={{ background: item.color }} />
                      {item.label}
                    </span>
                    <Skeleton width={32} height={14} variant="text" />
                  </div>
                ))}
              </div>
              <div className="kpi-foot">
                <Skeleton width={120} height={13} variant="text" />
              </div>
            </div>
          ) : (
            <>
              <div className="kpi-rows">
                <button
                  type="button"
                  disabled={kpi.unlinkedCount === 0}
                  aria-pressed={checkFilter === "unlinked"}
                  className={`kpi-row kpi-row-btn${checkFilter === "unlinked" ? " is-active" : ""}`}
                  onClick={() => selectCheckRow("unlinked")}
                >
                  <span className="l">
                    <i style={{ background: "#f5b301" }} />
                    레시피 미연결
                  </span>
                  <span className={`v${kpi.unlinkedCount > 0 ? " w" : ""}`}>
                    {Math.round(animUnlinked ?? kpi.unlinkedCount)}개
                  </span>
                </button>
                <button
                  type="button"
                  disabled={kpi.noCostCount === 0}
                  aria-pressed={checkFilter === "no_cost"}
                  className={`kpi-row kpi-row-btn${checkFilter === "no_cost" ? " is-active" : ""}`}
                  onClick={() => selectCheckRow("no_cost")}
                >
                  <span className="l">
                    <i style={{ background: "var(--kpi-c5)" }} />
                    단가 미입력
                  </span>
                  <span className={`v${kpi.noCostCount > 0 ? " w" : ""}`}>
                    {Math.round(animNoCost ?? kpi.noCostCount)}개
                  </span>
                </button>
              </div>
              <div className="kpi-foot">
                <span>
                  {kpi.needsCheckCount > 0 ? `${kpi.needsCheckCount}개 항목 확인 필요` : "확인할 항목 없음"}
                </span>
                {kpi.unlinkedCount > 0 ? (
                  <Link to="/menus">레시피 연결 →</Link>
                ) : kpi.noCostCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const firstNoCost = kpi.rows.find((r) => r.isNoCost)?.ingredient;
                      openInventoryAction("RECEIPT", firstNoCost);
                    }}
                  >
                    입고 등록 →
                  </button>
                ) : null}
              </div>
            </>
          )}
        </article>
      </section>

      <section className="kpi-table-section" aria-label="식자재 목록">
        <div className="kpi-bar">
          <div className="kpi-tabs" role="tablist" aria-label="상태">
            <button
              type="button"
              role="tab"
              aria-selected={filter === "all" && !checkFilter}
              className={filter === "all" && !checkFilter ? "on" : undefined}
              onClick={() => selectStatusTab("all")}
            >
              전체<em>{kpiLoading ? <Skeleton width={16} height={11} variant="text" /> : kpi.totalCount}</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "NEEDS_RESTOCK" && !checkFilter}
              className={filter === "NEEDS_RESTOCK" && !checkFilter ? "on" : undefined}
              onClick={() => selectStatusTab("NEEDS_RESTOCK")}
            >
              입고 필요<em>{kpiLoading ? <Skeleton width={16} height={11} variant="text" /> : kpi.needsRestockCount}</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "OUT_OF_STOCK" && !checkFilter}
              className={filter === "OUT_OF_STOCK" && !checkFilter ? "on" : undefined}
              onClick={() => selectStatusTab("OUT_OF_STOCK")}
            >
              재고 없음<em>{kpiLoading ? <Skeleton width={16} height={11} variant="text" /> : kpi.outOfStockCount}</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === "IDLE" && !checkFilter}
              className={filter === "IDLE" && !checkFilter ? "on" : undefined}
              onClick={() => selectStatusTab("IDLE")}
            >
              미사용<em>{kpiLoading ? <Skeleton width={16} height={11} variant="text" /> : kpi.idleCount}</em>
            </button>
          </div>
          <div className="kpi-right">
            {checkFilter && (
              <button
                type="button"
                className="chip chip-warn"
                style={{ cursor: "pointer" }}
                aria-label={`${CHECK_LABELS[checkFilter]} 필터 해제`}
                onClick={() => setCheckFilter("")}
              >
                {CHECK_LABELS[checkFilter]} ×
              </button>
            )}
            <input
              type="search"
              className="kpi-search"
              aria-label="식자재 이름 검색"
              placeholder="식자재 이름 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button
              type="button"
              className="kpi-ghost"
              disabled={kpiLoading || all.length === 0}
              onClick={() => openInventoryAction("COUNT")}
            >
              재고 실사
            </button>
            <button type="button" className="kpi-primary" onClick={() => setForm(EMPTY_FORM)}>
              + 식자재 추가
            </button>
          </div>
        </div>

        <div className="menu-table-region">
          {kpiLoading ? (
            <SkeletonTable
              tableClassName="kpi-table"
              ariaLabel="식자재 목록 불러오는 중"
              rows={7}
              columns={[
                { label: "식자재", width: "18%" },
                { label: "예상 재고", align: "right", width: "13%" },
                { label: "안전재고", align: "center", width: "22%" },
                { label: "최근 단가", align: "right", width: "14%" },
                { label: "평가금액", align: "right", width: "13%" },
                { label: "연결 메뉴", align: "center", width: "8%" },
                { label: "상태", align: "center", width: "12%" },
              ]}
            />
          ) : listQuery.isError ? (
            <EmptyState
              title="불러오지 못했습니다"
              actions={<Button label="다시 시도" onClick={() => void listQuery.refetch()} />}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="식자재가 없습니다"
              actions={
                <Button
                  variant="primary"
                  label="식자재 추가"
                  onClick={() => setForm(EMPTY_FORM)}
                />
              }
            />
          ) : (
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>식자재</th>
                  <th className="n">예상 재고</th>
                  <th style={{ textAlign: "center" }}>안전재고</th>
                  <th className="n">최근 단가</th>
                  <th className="n">평가금액</th>
                  <th className="c">연결 메뉴</th>
                  <th className="c">상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const enriched = enrichedById.get(r.id);
                  const uiStatus = enriched?.uiStatus ?? "OK";
                  const badge = UI_STATUS_BADGE[uiStatus];
                  const estimated = enriched?.estimatedQuantity ?? null;
                  const unitCostPurchase = enriched?.unitCostPerPurchase ?? null;
                  const evalWon = enriched?.evaluationWon ?? null;

                  return (
                    <tr key={r.id}>
                      <td>
                        <button
                          type="button"
                          className="ing-name-btn"
                          onClick={() => openEditForm(r)}
                        >
                          {r.name}
                        </button>
                      </td>
                      <td className={`n${estimated === null ? " kpi-na" : ""}`}>
                        {estimated !== null ? (
                          `${fmt(estimated)}${unitLabel(r.base_unit)}`
                        ) : (
                          "미산출"
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <SafetyStockSlider
                          ingredient={r}
                          estimatedQuantity={estimated}
                          onCommit={async (nextSafety) => {
                            await safetyMutation.mutateAsync({
                              id: r.id,
                              safety_stock: nextSafety,
                            });
                          }}
                        />
                      </td>
                      <td className={`n${unitCostPurchase === null ? " kpi-na" : ""}`}>
                        {unitCostPurchase !== null ? (
                          `${Math.round(unitCostPurchase).toLocaleString("ko-KR")}원/${unitLabel(
                            r.purchase_unit,
                          )}`
                        ) : (
                          "미산출"
                        )}
                      </td>
                      <td className={`n${evalWon === null ? " kpi-na" : ""}`}>
                        {evalWon !== null ? (
                          `${evalWon.toLocaleString("ko-KR")}원`
                        ) : (
                          "미산출"
                        )}
                      </td>
                      <td className="c">{r.linked_menu_count}</td>
                      <td className="c">
                        <div className="ing-status-cell">
                          <span className={`chip ${badge.className}`}>{badge.label}</span>
                          <MoreMenu
                            label={`${r.name} 메뉴`}
                            alignment="end"
                            items={[
                              { label: "수정", onClick: () => openEditForm(r) },
                              {
                                label: "입고 등록",
                                onClick: () => openInventoryAction("RECEIPT", r),
                              },
                              {
                                label: "재고 실사",
                                onClick: () => openInventoryAction("COUNT", r),
                              },
                              {
                                label: "재고 수정",
                                onClick: () => setAdjustTarget(r),
                              },
                              {
                                label: r.is_active ? "비활성화" : "활성화",
                                onClick: () => toggleMutation.mutate({ id: r.id, on: !r.is_active }),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="kpi-note">
          숫자는 개발 DB 샘플 매장 실제 값. 슬라이더 눈금 = 예상 재고 위치, 손잡이 = 안전재고. 단가는 최근 입고 기준(PROVISIONAL).
        </p>

        {pageCount > 1 ? (
          <footer className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-rule pt-3 text-xs text-muted tabular-nums">
            <div className="flex flex-wrap gap-x-4 gap-y-1" aria-live="polite" role="status">
              <span>
                {filteredIngredients.length > 0 ? `${offset + 1}–${offset + rows.length}` : "0"} /{" "}
                {filteredIngredients.length}개 · 페이지당 {PAGE_SIZE}개
              </span>
            </div>
            <InternationalizationProvider locale="ko-KR" messages={{ "ko-KR": koKR }}>
              <Pagination
                label="식자재 목록 페이지"
                page={page}
                totalPages={pageCount}
                size="sm"
                variant="compact"
                isDisabled={
                  kpiLoading || listQuery.isError || filteredIngredients.length === 0
                }
                onChange={(next) => setPagination({ filterKey, page: next })}
              />
            </InternationalizationProvider>
          </footer>
        ) : (
          <div className="sr-only">
            <InternationalizationProvider locale="ko-KR" messages={{ "ko-KR": koKR }}>
              <Pagination
                label="식자재 목록 페이지"
                page={page}
                totalPages={pageCount}
                size="sm"
                variant="compact"
                isDisabled={
                  kpiLoading || listQuery.isError || filteredIngredients.length === 0
                }
                onChange={(next) => setPagination({ filterKey, page: next })}
              />
            </InternationalizationProvider>
          </div>
        )}
      </section>

      {valuationModalOpen && (
        <Dialog label="재고 평가금액 전체 보기" onClose={() => setValuationModalOpen(false)}>
          <div className="kpi-detail-modal">
            <div className="kpi-modal-head">
              <div>
                <h2>재고 평가금액 전체</h2>
                <p className="kpi-modal-sub">
                  예상 재고 × 최근 입고 단가 · 합계 {kpi.totalEvaluationManWon}만원 (
                  {kpi.totalEvaluationWon.toLocaleString("ko-KR")}원)
                </p>
              </div>
              <button
                type="button"
                className="pill pill-sm pill-soft"
                onClick={() => setValuationModalOpen(false)}
              >
                닫기
              </button>
            </div>
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>식자재</th>
                  <th className="n">예상 재고</th>
                  <th className="n">최근 단가</th>
                  <th className="n">평가금액</th>
                  <th className="n">비중</th>
                </tr>
              </thead>
              <tbody>
                {kpi.allValuationItems.map((item) => (
                  <tr key={item.ingredientId}>
                    <td>{item.name}</td>
                    <td className="n">
                      {fmt(item.estimatedQuantity)}
                      {unitLabel(item.baseUnit)}
                    </td>
                    <td className="n">
                      {item.unitCostPerPurchase.toLocaleString("ko-KR")}원/
                      {unitLabel(item.purchaseUnit)}
                    </td>
                    <td className="n">{item.evaluationWon.toLocaleString("ko-KR")}원</td>
                    <td className="n">{item.sharePercent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Dialog>
      )}

      {adjustTarget && (
        <StockAdjustmentModal
          store={store}
          ingredient={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onSaved={(summaryText) => {
            setAdjustTarget(null);
            toast({ body: `${summaryText} 완료`, type: "info" });
            refresh();
          }}
        />
      )}

      <AstryxDialog
        isOpen={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
        purpose="form"
        aria-label={form?.id ? "식자재 수정" : "식자재 추가"}
        width={420}
      >
        {form && (
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.name.trim()) return fail(null, "이름을 입력하세요");
              saveMutation.mutate(form);
            }}
          >
            <Heading level={2}>{form.id ? "식자재 수정" : "식자재 추가"}</Heading>
            <TextInput
              label="식자재명"
              value={form.name}
              onChange={(name) => setForm({ ...form, name })}
              hasAutoFocus
            />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <NumberInput
                  label="안전재고"
                  value={form.safety}
                  hasClear
                  onChange={(safety) => setForm({ ...form, safety })}
                />
              </div>
              <Selector
                label="단위"
                isLabelHidden
                width={88}
                options={UNITS.map((u) => ({ value: u, label: unitLabel(u) }))}
                value={form.unit}
                onChange={(unit) => setForm({ ...form, unit: unit as PurchaseUnitType })}
              />
            </div>
            <TextInput
              label="메모"
              value={form.notes}
              onChange={(notes) => setForm({ ...form, notes })}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" label="취소" onClick={() => setForm(null)} />
              <Button
                variant="primary"
                type="submit"
                label="저장"
                isLoading={saveMutation.isPending}
              />
            </div>
          </form>
        )}
      </AstryxDialog>

      {inventoryAction && (
        <ActionDialog
          key={`${inventoryAction.item.ingredient_id}:${inventoryAction.action}`}
          store={store}
          item={inventoryAction.item}
          items={allInventoryItems}
          action={inventoryAction.action}
          onSelect={(item) => setInventoryAction({ item, action: inventoryAction.action })}
          onClose={() => setInventoryAction(null)}
          onDone={(text) => {
            setInventoryAction(null);
            toast({ body: `${text} 완료`, type: "info" });
            refresh();
          }}
        />
      )}
    </div>
  );
}

export function RestockHeroCard({
  totalCount,
  activeCount,
  topItems,
  onSelect,
}: {
  totalCount: number;
  activeCount: number;
  topItems: RestockUrgentItem[];
  onSelect: () => void;
}) {
  return (
    <section
      role="button"
      tabIndex={0}
      aria-label={`입고 필요 ${totalCount}종 보기`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="card restock-hero-card flex cursor-pointer flex-col justify-between gap-3 text-left !bg-accent-600 text-white"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="kpi-label flex items-center gap-2 !text-white/80">
          {totalCount > 0 && (
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-300" />
          )}
          입고 필요
        </div>
        <div className="text-xl leading-none font-semibold tracking-tight !text-white tabular-nums">
          {totalCount}
          <small className="ml-0.5 text-xs font-normal !text-white/90">종</small>
        </div>
      </div>

      {topItems.length === 0 ? (
        <p className="text-xs text-white/80">활성 {activeCount}종 모두 충분</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {topItems.map((it, idx) => (
            <li
              key={it.ingredient_id}
              className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2.5"
            >
              <span className="text-xs text-white/75 tabular-nums">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="truncate text-xs font-medium text-white" title={it.name}>
                {it.name}
              </span>
              <span className="text-xs font-semibold text-white tabular-nums">
                {it.shortage_amount > 0 ? `-${fmt(it.shortage_amount)}` : fmt(it.safety_stock)}
                <small className="ml-0.5 text-[11px] font-normal text-white/80">
                  {unitLabel(it.unit)}
                </small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
