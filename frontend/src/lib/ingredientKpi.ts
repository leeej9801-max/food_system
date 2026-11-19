import type { BaseUnitType, Ingredient, IngredientInventoryItem } from "../types";

export type IngredientUiStatus = "OK" | "NEEDS_RESTOCK" | "OUT_OF_STOCK" | "IDLE";
export type IngredientCheckCondition = "unlinked" | "no_cost";

export interface IngredientValuationRow {
  id: string;
  label: string;
  amountWon: number;
  sharePercent: number;
  roundedSharePercent: number;
  colorVar: string;
}

export interface IngredientValuationDetailRow {
  ingredientId: string;
  name: string;
  estimatedQuantity: number;
  baseUnit: BaseUnitType;
  unitCostPerPurchase: number;
  purchaseUnit: string;
  evaluationWon: number;
  sharePercent: number;
}

export interface IngredientEnrichedRow {
  ingredient: Ingredient;
  inventory: IngredientInventoryItem | null;
  estimatedQuantity: number | null;
  safetyStock: number | null;
  safetyRatio: number | null;
  gaugePercent: number;
  unitCostPerPurchase: number | null;
  unitCostPerBase: number | null;
  evaluationWon: number | null;
  uiStatus: IngredientUiStatus;
  isUnlinked: boolean;
  isNoCost: boolean;
  needsCheck: boolean;
}

export interface IngredientKpiSummary {
  totalCount: number;
  lastCountedLabel: string | null;
  totalEvaluationWon: number;
  totalEvaluationManWon: string;
  valuationSegments: { id: string; flex: number; colorVar: string }[];
  valuationRows: IngredientValuationRow[];
  allValuationItems: IngredientValuationDetailRow[];
  sufficientCount: number;
  needsRestockCount: number;
  outOfStockCount: number;
  idleCount: number;
  restockExpectedWon: number;
  noConsumptionCount: number;
  unlinkedCount: number;
  noCostCount: number;
  needsCheckCount: number;
  needsCheckCategoryCount: number;
  stockDaysLabel: string;
  rows: IngredientEnrichedRow[];
}

const STACK_COLORS = [
  "var(--kpi-c1)",
  "var(--kpi-c2)",
  "var(--kpi-c3)",
  "var(--kpi-c5)",
];

export function shortIngredientName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, "")
    .replace(/^엑스트라버진\s+/, "")
    .trim();
}

export function getSafetySliderSpec(
  baseSafety: number | null | undefined,
  baseUnit: BaseUnitType,
): { max: number; step: number } {
  const step = baseUnit === "ea" ? 1 : 10;
  const safeBase = baseSafety !== null && baseSafety !== undefined && baseSafety > 0 ? baseSafety : 0;
  const max = safeBase > 0 ? Math.max(step, safeBase * 2) : 10;
  return { max, step };
}

export function getEstimatedTickPercent(
  estimatedQuantity: number | null,
  sliderMax: number,
): number | null {
  if (estimatedQuantity === null || sliderMax <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((estimatedQuantity / sliderMax) * 100)));
}

export function matchesIngredientCheckCondition(
  row: IngredientEnrichedRow | undefined,
  condition: IngredientCheckCondition | "",
): boolean {
  if (!row) return false;
  if (condition === "unlinked") return row.isUnlinked;
  if (condition === "no_cost") return row.isNoCost;
  return row.needsCheck;
}

export function formatCountDateKorean(iso: string | null, timeZone = "Asia/Seoul"): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const month = parts.find((p) => p.type === "month")?.value.replace(/\D/g, "");
  const day = parts.find((p) => p.type === "day")?.value.replace(/\D/g, "");
  return month && day ? `${Number(month)}월 ${Number(day)}일` : null;
}

export function computeIngredientKpi(
  ingredients: Ingredient[],
  inventorySummary: IngredientInventoryItem[] = [],
  timeZone = "Asia/Seoul",
): IngredientKpiSummary {
  const invById = new Map(inventorySummary.map((item) => [item.ingredient_id, item]));

  let latestCountedIso: string | null = null;
  for (const inv of inventorySummary) {
    if (!inv.last_counted_at) continue;
    if (!latestCountedIso || new Date(inv.last_counted_at) > new Date(latestCountedIso)) {
      latestCountedIso = inv.last_counted_at;
    }
  }

  let sufficientCount = 0;
  let needsRestockCount = 0;
  let outOfStockCount = 0;
  let idleCount = 0;
  let restockExpectedRaw = 0;
  let noConsumptionCount = 0;
  let unlinkedCount = 0;
  let noCostCount = 0;
  let needsCheckCount = 0;

  const valuedItems: {
    id: string;
    name: string;
    estimatedQuantity: number;
    baseUnit: BaseUnitType;
    unitCostPerPurchase: number;
    purchaseUnit: string;
    rawValue: number;
  }[] = [];

  const rows: IngredientEnrichedRow[] = ingredients.map((ing) => {
    const inv = invById.get(ing.id) ?? null;
    const estimatedQuantity = inv !== null ? Number(inv.estimated_quantity) : null;
    const safetyRaw = ing.safety_stock ?? inv?.safety_stock ?? null;
    const safetyStock = safetyRaw !== null ? Number(safetyRaw) : null;

    const unitCostPerBase =
      inv?.latest_unit_cost_per_base !== null && inv?.latest_unit_cost_per_base !== undefined
        ? Number(inv.latest_unit_cost_per_base)
        : null;
    const unitCostPerPurchase =
      inv?.latest_unit_cost_per_purchase !== null &&
      inv?.latest_unit_cost_per_purchase !== undefined
        ? Number(inv.latest_unit_cost_per_purchase)
        : null;

    const rawEval =
      estimatedQuantity !== null && unitCostPerBase !== null
        ? Math.max(0, estimatedQuantity) * unitCostPerBase
        : null;
    const evaluationWon = rawEval !== null ? Math.round(rawEval) : null;

    if (rawEval !== null && rawEval > 0 && estimatedQuantity !== null) {
      valuedItems.push({
        id: ing.id,
        name: ing.name,
        estimatedQuantity,
        baseUnit: ing.base_unit,
        unitCostPerPurchase: unitCostPerPurchase ?? unitCostPerBase ?? 0,
        purchaseUnit: ing.purchase_unit,
        rawValue: rawEval,
      });
    }

    const safetyRatio =
      estimatedQuantity !== null && safetyStock !== null && safetyStock > 0
        ? estimatedQuantity / safetyStock
        : null;
    const gaugePercent =
      safetyRatio !== null ? Math.min(100, Math.max(0, Math.round((safetyRatio / 2) * 100))) : 0;

    const isIdle =
      !ing.is_active ||
      ing.stock_status === "INACTIVE" ||
      ing.stock_status === "IDLE" ||
      ing.linked_menu_count === 0;
    const isOutOfStock =
      (estimatedQuantity !== null && estimatedQuantity <= 0) ||
      inv?.stock_status === "NEGATIVE_WARNING";
    const isNeedsRestock =
      !isOutOfStock &&
      (ing.stock_status === "NEEDS_RESTOCK" ||
        inv?.stock_status === "LOW_STOCK" ||
        (estimatedQuantity !== null &&
          safetyStock !== null &&
          safetyStock > 0 &&
          estimatedQuantity < safetyStock));

    let uiStatus: IngredientUiStatus = "OK";
    if (isOutOfStock) {
      uiStatus = "OUT_OF_STOCK";
    } else if (isNeedsRestock) {
      uiStatus = "NEEDS_RESTOCK";
    } else if (isIdle) {
      uiStatus = "IDLE";
    }

    if (isIdle) {
      idleCount += 1;
    }
    if (isOutOfStock) {
      outOfStockCount += 1;
    } else if (isNeedsRestock) {
      needsRestockCount += 1;
    } else {
      sufficientCount += 1;
    }

    if (
      (isOutOfStock || isNeedsRestock) &&
      safetyStock !== null &&
      estimatedQuantity !== null &&
      estimatedQuantity < safetyStock &&
      unitCostPerBase !== null
    ) {
      restockExpectedRaw += (safetyStock - Math.max(0, estimatedQuantity)) * unitCostPerBase;
    }

    if (!inv || Number(inv.theoretical_consumption_base) <= 0) {
      noConsumptionCount += 1;
    }
    const isUnlinked = ing.linked_menu_count === 0;
    const isNoCost = unitCostPerBase === null;
    const needsCheck = isUnlinked || isNoCost;

    if (isUnlinked) {
      unlinkedCount += 1;
    }
    if (isNoCost) {
      noCostCount += 1;
    }
    if (needsCheck) {
      needsCheckCount += 1;
    }

    return {
      ingredient: ing,
      inventory: inv,
      estimatedQuantity,
      safetyStock,
      safetyRatio,
      gaugePercent,
      unitCostPerPurchase,
      unitCostPerBase,
      evaluationWon,
      uiStatus,
      isUnlinked,
      isNoCost,
      needsCheck,
    };
  });

  rows.sort((a, b) => {
    const av = a.evaluationWon ?? -1;
    const bv = b.evaluationWon ?? -1;
    if (bv !== av) return bv - av;
    return a.ingredient.name.localeCompare(b.ingredient.name, "ko-KR");
  });

  valuedItems.sort((a, b) => b.rawValue - a.rawValue);
  const totalEvaluationRaw = valuedItems.reduce((sum, item) => sum + item.rawValue, 0);
  const totalEvaluationWon = Math.round(totalEvaluationRaw);
  const totalEvaluationManWon = (totalEvaluationRaw / 10000).toFixed(1);

  const allValuationItems: IngredientValuationDetailRow[] = valuedItems.map((item) => {
    const share = totalEvaluationRaw > 0 ? (item.rawValue / totalEvaluationRaw) * 100 : 0;
    return {
      ingredientId: item.id,
      name: item.name,
      estimatedQuantity: item.estimatedQuantity,
      baseUnit: item.baseUnit,
      unitCostPerPurchase: Math.round(item.unitCostPerPurchase),
      purchaseUnit: item.purchaseUnit,
      evaluationWon: Math.round(item.rawValue),
      sharePercent: Number(share.toFixed(1)),
    };
  });

  const groupedValuation =
    valuedItems.length <= 3
      ? valuedItems.map((it) => ({ id: it.id, label: it.name, rawValue: it.rawValue }))
      : [
          ...valuedItems.slice(0, 3).map((it) => ({
            id: it.id,
            label: it.name,
            rawValue: it.rawValue,
          })),
          {
            id: "rest",
            label: `그 외 ${valuedItems.length - 3}개`,
            rawValue: valuedItems.slice(3).reduce((sum, item) => sum + item.rawValue, 0),
          },
        ];

  const valuationRows: IngredientValuationRow[] = groupedValuation.map((item, idx) => {
    const share = totalEvaluationRaw > 0 ? (item.rawValue / totalEvaluationRaw) * 100 : 0;
    const colorVar = item.id === "rest" ? "var(--kpi-c5)" : STACK_COLORS[idx % 3];
    return {
      id: item.id,
      label: item.label,
      amountWon: Math.round(item.rawValue),
      sharePercent: Number(share.toFixed(1)),
      roundedSharePercent: Math.round(share),
      colorVar,
    };
  });

  const valuationSegments = valuationRows.map((row) => ({
    id: row.id,
    flex: Number(Math.max(0.1, row.sharePercent).toFixed(1)),
    colorVar: row.colorVar,
  }));

  const needsCheckCategoryCount = [unlinkedCount, noCostCount].filter((c) => c > 0).length;

  const stockDaysLabel =
    ingredients.length === 0 || noConsumptionCount === ingredients.length
      ? "재고일수 미산출"
      : `소진 기록 ${ingredients.length - noConsumptionCount}종 산출`;

  return {
    totalCount: ingredients.length,
    lastCountedLabel: formatCountDateKorean(latestCountedIso, timeZone),
    totalEvaluationWon,
    totalEvaluationManWon,
    valuationSegments,
    valuationRows,
    allValuationItems,
    sufficientCount,
    needsRestockCount,
    outOfStockCount,
    idleCount,
    restockExpectedWon: Math.round(restockExpectedRaw),
    noConsumptionCount,
    unlinkedCount,
    noCostCount,
    needsCheckCount,
    needsCheckCategoryCount,
    stockDaysLabel,
    rows,
  };
}

