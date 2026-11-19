import { describe, expect, it } from "vitest";
import {
  computeIngredientKpi,
  getEstimatedTickPercent,
  getSafetySliderSpec,
} from "./ingredientKpi";
import type { Ingredient, IngredientInventoryItem } from "../types";

const sampleIngredients: Ingredient[] = [
  {
    id: "ing-1",
    store_id: "s-1",
    name: "관찰레(이탈리아산)",
    base_unit: "g",
    purchase_unit: "kg",
    conversion_factor: "1000.0000",
    safety_stock: "500.000",
    notes: null,
    is_active: true,
    linked_menu_count: 1,
    stock_status: "IN_USE",
    created_at: "2026-11-17T00:00:00Z",
    updated_at: "2026-11-17T00:00:00Z",
  },
  {
    id: "ing-2",
    store_id: "s-1",
    name: "스파게티면(데체코)",
    base_unit: "g",
    purchase_unit: "kg",
    conversion_factor: "1000.0000",
    safety_stock: "1500.000",
    notes: null,
    is_active: true,
    linked_menu_count: 2,
    stock_status: "IN_USE",
    created_at: "2026-11-17T00:00:00Z",
    updated_at: "2026-11-17T00:00:00Z",
  },
  {
    id: "ing-3",
    store_id: "s-1",
    name: "엑스트라버진 올리브오일",
    base_unit: "ml",
    purchase_unit: "L",
    conversion_factor: "1000.0000",
    safety_stock: "500.000",
    notes: null,
    is_active: true,
    linked_menu_count: 2,
    stock_status: "IN_USE",
    created_at: "2026-11-17T00:00:00Z",
    updated_at: "2026-11-17T00:00:00Z",
  },
  {
    id: "ing-4",
    store_id: "s-1",
    name: "페코리노 로마노 치즈",
    base_unit: "g",
    purchase_unit: "kg",
    conversion_factor: "1000.0000",
    safety_stock: "400.000",
    notes: null,
    is_active: true,
    linked_menu_count: 2,
    stock_status: "IN_USE",
    created_at: "2026-11-17T00:00:00Z",
    updated_at: "2026-11-17T00:00:00Z",
  },
  {
    id: "ing-5",
    store_id: "s-1",
    name: "프라임 부채살",
    base_unit: "g",
    purchase_unit: "kg",
    conversion_factor: "1000.0000",
    safety_stock: "1000.000",
    notes: null,
    is_active: true,
    linked_menu_count: 1,
    stock_status: "IN_USE",
    created_at: "2026-11-17T00:00:00Z",
    updated_at: "2026-11-17T00:00:00Z",
  },
];

const sampleSummary: IngredientInventoryItem[] = [
  {
    ingredient_id: "ing-1",
    ingredient_name: "관찰레(이탈리아산)",
    is_active: true,
    base_unit: "g",
    purchase_unit: "kg",
    conversion_factor: "1000.0000",
    safety_stock: "500.000",
    latest_unit_cost_per_purchase: "44452.94",
    latest_unit_cost_per_base: "44.4529",
    cost_basis_label: "PROVISIONAL",
    last_actual_quantity: "1000.000",
    last_counted_at: "2026-11-18T14:00:00Z",
    receipts_since_count_base: "0.000",
    theoretical_consumption_base: "0.000",
    adjustments_since_count_base: "0.000",
    estimated_quantity: "1000.000",
    stock_status: "OK",
  },
  {
    ingredient_id: "ing-2",
    ingredient_name: "스파게티면(데체코)",
    is_active: true,
    base_unit: "g",
    purchase_unit: "kg",
    conversion_factor: "1000.0000",
    safety_stock: "1500.000",
    latest_unit_cost_per_purchase: "12502.56",
    latest_unit_cost_per_base: "12.5026",
    cost_basis_label: "PROVISIONAL",
    last_actual_quantity: "3000.000",
    last_counted_at: "2026-11-18T14:00:00Z",
    receipts_since_count_base: "0.000",
    theoretical_consumption_base: "0.000",
    adjustments_since_count_base: "0.000",
    estimated_quantity: "3000.000",
    stock_status: "OK",
  },
  {
    ingredient_id: "ing-3",
    ingredient_name: "엑스트라버진 올리브오일",
    is_active: true,
    base_unit: "ml",
    purchase_unit: "L",
    conversion_factor: "1000.0000",
    safety_stock: "500.000",
    latest_unit_cost_per_purchase: "25003.96",
    latest_unit_cost_per_base: "25.0040",
    cost_basis_label: "PROVISIONAL",
    last_actual_quantity: "1000.000",
    last_counted_at: "2026-11-18T14:00:00Z",
    receipts_since_count_base: "0.000",
    theoretical_consumption_base: "0.000",
    adjustments_since_count_base: "0.000",
    estimated_quantity: "1000.000",
    stock_status: "OK",
  },
  {
    ingredient_id: "ing-4",
    ingredient_name: "페코리노 로마노 치즈",
    is_active: true,
    base_unit: "g",
    purchase_unit: "kg",
    conversion_factor: "1000.0000",
    safety_stock: "400.000",
    latest_unit_cost_per_purchase: "62511.63",
    latest_unit_cost_per_base: "62.5116",
    cost_basis_label: "PROVISIONAL",
    last_actual_quantity: "800.000",
    last_counted_at: "2026-11-18T14:00:00Z",
    receipts_since_count_base: "0.000",
    theoretical_consumption_base: "0.000",
    adjustments_since_count_base: "0.000",
    estimated_quantity: "800.000",
    stock_status: "OK",
  },
  {
    ingredient_id: "ing-5",
    ingredient_name: "프라임 부채살",
    is_active: true,
    base_unit: "g",
    purchase_unit: "kg",
    conversion_factor: "1000.0000",
    safety_stock: "1000.000",
    latest_unit_cost_per_purchase: "58345.45",
    latest_unit_cost_per_base: "58.3455",
    cost_basis_label: "PROVISIONAL",
    last_actual_quantity: "2000.000",
    last_counted_at: "2026-11-18T14:00:00Z",
    receipts_since_count_base: "0.000",
    theoretical_consumption_base: "0.000",
    adjustments_since_count_base: "0.000",
    estimated_quantity: "2000.000",
    stock_status: "OK",
  },
];

describe("computeIngredientKpi", () => {
  it("샘플 매장 데이터를 시안 v5 평가금액 상위 3개 + '그 외 N개'로 정확히 계산한다", () => {
    const kpi = computeIngredientKpi(sampleIngredients, sampleSummary, "Asia/Seoul");

    expect(kpi.totalCount).toBe(5);
    expect(kpi.lastCountedLabel).toBe("11월 18일");
    expect(kpi.totalEvaluationManWon).toBe("27.4");
    expect(kpi.valuationRows.map((r) => [r.label, r.amountWon, r.roundedSharePercent])).toEqual([
      ["프라임 부채살", 116691, 43],
      ["페코리노 로마노 치즈", 50009, 18],
      ["관찰레(이탈리아산)", 44453, 16],
      ["그 외 2개", 62512, 23],
    ]);
    expect(kpi.valuationSegments).toHaveLength(4);
    expect(kpi.valuationSegments[3].colorVar).toBe("var(--kpi-c5)");
    expect(kpi.allValuationItems).toHaveLength(5);

    expect(kpi.sufficientCount).toBe(5);
    expect(kpi.needsRestockCount).toBe(0);
    expect(kpi.outOfStockCount).toBe(0);
    expect(kpi.idleCount).toBe(0);
    expect(kpi.restockExpectedWon).toBe(0);

    expect(kpi.noConsumptionCount).toBe(5);
    expect(kpi.unlinkedCount).toBe(0);
    expect(kpi.noCostCount).toBe(0);
    expect(kpi.needsCheckCount).toBe(0);
    expect(kpi.needsCheckCategoryCount).toBe(0);
    expect(kpi.stockDaysLabel).toBe("재고일수 미산출");

    expect(kpi.rows[0].ingredient.name).toBe("프라임 부채살");
    expect(kpi.rows[0].safetyRatio).toBe(2);
    expect(kpi.rows[0].gaugePercent).toBe(100);
  });

  it("안전재고 슬라이더 범위(2배, 0일 때 10)와 단위별 step을 계산한다", () => {
    expect(getSafetySliderSpec(500, "g")).toEqual({ max: 1000, step: 10 });
    expect(getSafetySliderSpec(300, "ml")).toEqual({ max: 600, step: 10 });
    expect(getSafetySliderSpec(5, "ea")).toEqual({ max: 10, step: 1 });
    expect(getSafetySliderSpec(0, "g")).toEqual({ max: 10, step: 10 });
    expect(getSafetySliderSpec(null, "ea")).toEqual({ max: 10, step: 1 });

    expect(getEstimatedTickPercent(500, 1000)).toBe(50);
    expect(getEstimatedTickPercent(1200, 1000)).toBe(100);
    expect(getEstimatedTickPercent(null, 1000)).toBeNull();
  });
});

