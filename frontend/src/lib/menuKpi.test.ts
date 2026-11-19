import { describe, expect, it } from "vitest";
import { computeMenuKpi } from "./menuKpi";
import type {
  CostSimulationResponse,
  MenuItem,
  SalesAnalyticsResponse,
} from "../types";

const sampleMenus: MenuItem[] = [
  {
    id: "m-carb",
    store_id: "s-1",
    name: "까르보나라",
    selling_price: "16000.00",
    category: "파스타",
    description: null,
    is_active: true,
    pos_mapping_status: "LINKED",
    recipe_status: "COMPLETE",
    recipe_item_count: 3,
    created_at: "2026-11-17T00:00:00Z",
    updated_at: "2026-11-17T00:00:00Z",
  },
  {
    id: "m-steak",
    store_id: "s-1",
    name: "부채살 스테이크",
    selling_price: "29000.00",
    category: "스테이크",
    description: null,
    is_active: true,
    pos_mapping_status: "LINKED",
    recipe_status: "COMPLETE",
    recipe_item_count: 2,
    created_at: "2026-11-17T00:00:00Z",
    updated_at: "2026-11-17T00:00:00Z",
  },
  {
    id: "m-aglio",
    store_id: "s-1",
    name: "알리오올리오",
    selling_price: "14000.00",
    category: "파스타",
    description: null,
    is_active: true,
    pos_mapping_status: "LINKED",
    recipe_status: "COMPLETE",
    recipe_item_count: 3,
    created_at: "2026-11-17T00:00:00Z",
    updated_at: "2026-11-17T00:00:00Z",
  },
  {
    id: "m-wine",
    store_id: "s-1",
    name: "하우스 와인(글라스)",
    selling_price: "9000.00",
    category: "음료/와인",
    description: null,
    is_active: true,
    pos_mapping_status: "LINKED",
    recipe_status: "UNREGISTERED",
    recipe_item_count: 0,
    created_at: "2026-11-17T00:00:00Z",
    updated_at: "2026-11-17T00:00:00Z",
  },
];

const sampleCosts: CostSimulationResponse = {
  store_id: "s-1",
  cost_basis_label: "최근 입고 단가 기준 (PROVISIONAL P-12)",
  global_change_percent: "0.00",
  menus: [
    {
      menu_item_id: "m-carb",
      menu_name: "까르보나라",
      category: "파스타",
      selling_price: "16000.00",
      cost_status: "COMPLETE",
      missing_cost_ingredients: [],
      base_recipe_cost: "5598.30",
      simulated_recipe_cost: "5598.30",
      cost_delta: "0.00",
      base_margin: "10401.70",
      simulated_margin: "10401.70",
      base_cost_ratio_percent: "34.99",
      simulated_cost_ratio_percent: "34.99",
      high_cost_warning: false,
      breakdown: [],
    },
    {
      menu_item_id: "m-steak",
      menu_name: "부채살 스테이크",
      category: "스테이크",
      selling_price: "29000.00",
      cost_status: "COMPLETE",
      missing_cost_ingredients: [],
      base_recipe_cost: "13336.09",
      simulated_recipe_cost: "13336.09",
      cost_delta: "0.00",
      base_margin: "15663.91",
      simulated_margin: "15663.91",
      base_cost_ratio_percent: "45.99",
      simulated_cost_ratio_percent: "45.99",
      high_cost_warning: true,
      breakdown: [],
    },
    {
      menu_item_id: "m-aglio",
      menu_name: "알리오올리오",
      category: "파스타",
      selling_price: "14000.00",
      cost_status: "COMPLETE",
      missing_cost_ingredients: [],
      base_recipe_cost: "3563.16",
      simulated_recipe_cost: "3563.16",
      cost_delta: "0.00",
      base_margin: "10436.84",
      simulated_margin: "10436.84",
      base_cost_ratio_percent: "25.45",
      simulated_cost_ratio_percent: "25.45",
      high_cost_warning: false,
      breakdown: [],
    },
    {
      menu_item_id: "m-wine",
      menu_name: "하우스 와인(글라스)",
      category: "음료/와인",
      selling_price: "9000.00",
      cost_status: "NO_RECIPE",
      missing_cost_ingredients: [],
      base_recipe_cost: "0.00",
      simulated_recipe_cost: "0.00",
      cost_delta: "0.00",
      base_margin: "9000.00",
      simulated_margin: "9000.00",
      base_cost_ratio_percent: null,
      simulated_cost_ratio_percent: null,
      high_cost_warning: false,
      breakdown: [],
    },
  ],
};

const sampleSales: SalesAnalyticsResponse = {
  store_id: "s-1",
  total_completed_orders: 4093,
  total_quantity: 8902,
  total_net_sales: "148677000.00",
  known_hour_quantity: 8902,
  unknown_hour_quantity: 0,
  hourly_buckets: [],
  menu_rankings: [
    {
      menu_item_id: "m-carb",
      menu_name: "까르보나라",
      mapping_status: "MAPPED",
      quantity: 3567,
      sales_amount: "57072000.00",
    },
    {
      menu_item_id: "m-aglio",
      menu_name: "알리오올리오",
      mapping_status: "MAPPED",
      quantity: 2582,
      sales_amount: "36148000.00",
    },
    {
      menu_item_id: "m-steak",
      menu_name: "부채살 스테이크",
      mapping_status: "MAPPED",
      quantity: 1534,
      sales_amount: "44486000.00",
    },
    {
      menu_item_id: "m-wine",
      menu_name: "하우스 와인(글라스)",
      mapping_status: "MAPPED",
      quantity: 1219,
      sales_amount: "10971000.00",
    },
  ],
};

describe("computeMenuKpi", () => {
  it("샘플 매장 데이터를 시안 v5 수치와 동일하게 계산한다", () => {
    const kpi = computeMenuKpi(sampleMenus, sampleCosts, sampleSales);

    expect(kpi.totalContributionManWon).toBe(8808);
    expect(kpi.contributionRows.map((r) => [r.label, r.amountManWon, r.roundedSharePercent])).toEqual([
      ["까르보나라", 3710, 42],
      ["알리오올리오", 2695, 31],
      ["부채살 스테이크", 2403, 27],
    ]);
    expect(kpi.allContributionItems).toHaveLength(3);
    expect(kpi.allContributionItems[0]).toEqual({
      menuId: "m-carb",
      name: "까르보나라",
      quantity: 3567,
      marginWon: 10402,
      profitWon: 37102864,
      profitManWon: 3710,
      sharePercent: 42.1,
    });

    expect(kpi.weightedAvgCostRatio?.toFixed(1)).toBe("36.0");
    expect(kpi.minCostRatio?.toFixed(1)).toBe("25.5");
    expect(kpi.maxCostRatio?.toFixed(1)).toBe("46.0");
    expect(kpi.minCostMenuName).toBe("알리오올리오");
    expect(kpi.maxCostMenuName).toBe("부채살 스테이크");
    expect(kpi.avgCostLeftPercent).toBe(52);
    expect(kpi.maxCostWarning).toBe(true);

    expect(kpi.costDots.map((d) => [d.name, d.leftPercent, d.highCostWarning])).toEqual([
      ["알리오올리오", 0, false],
      ["까르보나라", 46, false],
      ["부채살 스테이크", 100, true],
    ]);

    expect(kpi.costedMenuCount).toBe(3);
    expect(kpi.totalMenuCount).toBe(4);
    expect(kpi.highCostCount).toBe(1);
    expect(kpi.unregisteredRecipeCount).toBe(1);
    expect(kpi.noPriceCount).toBe(0);
    expect(kpi.needsCheckCount).toBe(2);
    expect(kpi.firstAction).toEqual({
      menu: sampleMenus[3],
      label: "레시피 등록 →",
      kind: "RECIPE",
    });

    // 레시피 없는 메뉴는 원가율·마진·공헌이익 모두 null(미산출), 판매 비중만 계산
    const wineMetrics = kpi.byMenuId.get("m-wine")!;
    expect(wineMetrics.costRatioPercent).toBeNull();
    expect(wineMetrics.marginWon).toBeNull();
    expect(wineMetrics.contributionProfitWon).toBeNull();
    expect(Math.round(wineMetrics.salesSharePercent!)).toBe(7);
  });

  it("공헌이익 산출 메뉴가 4개 이상이면 상위 3개 + '그 외 N개'로 묶고 회색(c5)을 쓴다", () => {
    const menus5: MenuItem[] = [
      ...sampleMenus.slice(0, 3),
      { ...sampleMenus[0], id: "m-4", name: "라자냐", selling_price: "18000.00" },
      { ...sampleMenus[0], id: "m-5", name: "뇨끼", selling_price: "15000.00" },
    ];
    const costs5: CostSimulationResponse = {
      ...sampleCosts,
      menus: [
        ...sampleCosts.menus.slice(0, 3),
        {
          ...sampleCosts.menus[0],
          menu_item_id: "m-4",
          menu_name: "라자냐",
          selling_price: "18000.00",
          base_recipe_cost: "6000.00",
          base_margin: "12000.00",
          base_cost_ratio_percent: "33.33",
        },
        {
          ...sampleCosts.menus[0],
          menu_item_id: "m-5",
          menu_name: "뇨끼",
          selling_price: "15000.00",
          base_recipe_cost: "5000.00",
          base_margin: "10000.00",
          base_cost_ratio_percent: "33.33",
        },
      ],
    };
    const sales5: SalesAnalyticsResponse = {
      ...sampleSales,
      menu_rankings: [
        ...sampleSales.menu_rankings.slice(0, 3),
        {
          menu_item_id: "m-4",
          menu_name: "라자냐",
          mapping_status: "MAPPED",
          quantity: 500,
          sales_amount: "9000000.00",
        },
        {
          menu_item_id: "m-5",
          menu_name: "뇨끼",
          mapping_status: "MAPPED",
          quantity: 300,
          sales_amount: "4500000.00",
        },
      ],
    };

    const kpi = computeMenuKpi(menus5, costs5, sales5);
    expect(kpi.contributionRows).toHaveLength(4);
    expect(kpi.contributionRows[3].label).toBe("그 외 2개");
    expect(kpi.contributionRows[3].colorVar).toBe("var(--kpi-c5)");
    expect(kpi.contributionSegments).toHaveLength(4);
    expect(kpi.allContributionItems).toHaveLength(5);
  });

  it("원가나 판매 데이터가 없으면 미산출(null)로 안전하게 처리한다", () => {
    const kpi = computeMenuKpi(sampleMenus, null, null);
    expect(kpi.totalContributionManWon).toBeNull();
    expect(kpi.weightedAvgCostRatio).toBeNull();
    expect(kpi.costDots).toHaveLength(0);
    expect(kpi.byMenuId.get("m-carb")?.salesSharePercent).toBeNull();
  });
});
