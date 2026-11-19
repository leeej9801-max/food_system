import type {
  CostSimulationResponse,
  MenuCostSimulationItem,
  MenuItem,
  SalesAnalyticsResponse,
} from "../types";

export interface MenuContributionRow {
  id: string;
  label: string;
  amountWon: number;
  amountManWon: number;
  sharePercent: number;
  roundedSharePercent: number;
  colorVar: string;
}

export interface MenuContributionDetailRow {
  menuId: string;
  name: string;
  quantity: number;
  marginWon: number;
  profitWon: number;
  profitManWon: number;
  sharePercent: number;
}

export interface MenuCostDot {
  menuId: string;
  name: string;
  ratioPercent: number;
  leftPercent: number;
  highCostWarning: boolean;
}

export type MenuCheckCondition = "high_cost" | "unregistered_recipe" | "no_price";

export interface MenuRowMetrics {
  costRatioPercent: number | null;
  marginWon: number | null;
  highCostWarning: boolean;
  isUnregisteredRecipe: boolean;
  isNoPrice: boolean;
  salesSharePercent: number | null;
  salesShareBarPx: number;
  contributionProfitWon: number | null;
  needsCheck: boolean;
}

export interface MenuCheckAction {
  menu: MenuItem;
  label: string;
  kind: "RECIPE" | "PRICE" | "HIGH_COST";
}

export interface MenuKpiSummary {
  totalContributionWon: number | null;
  totalContributionManWon: number | null;
  contributionSegments: { id: string; flex: number; colorVar: string }[];
  contributionRows: MenuContributionRow[];
  allContributionItems: MenuContributionDetailRow[];
  weightedAvgCostRatio: number | null;
  avgCostLeftPercent: number;
  minCostRatio: number | null;
  maxCostRatio: number | null;
  minCostMenuName: string | null;
  maxCostMenuName: string | null;
  maxCostWarning: boolean;
  costDots: MenuCostDot[];
  costedMenuCount: number;
  totalMenuCount: number;
  highCostCount: number;
  unregisteredRecipeCount: number;
  noPriceCount: number;
  needsCheckCount: number;
  firstAction: MenuCheckAction | null;
  byMenuId: Map<string, MenuRowMetrics>;
}

const STACK_COLORS = ["var(--kpi-c1)", "var(--kpi-c2)", "var(--kpi-c3)", "var(--kpi-c5)"];

export function roundOneDecimal(value: number): number {
  return Math.round((value + 1e-9) * 10) / 10;
}

export function formatPercentOne(value: number): string {
  return roundOneDecimal(value).toFixed(1);
}

export function matchesMenuCheckCondition(
  metrics: MenuRowMetrics | undefined,
  condition: MenuCheckCondition | "",
): boolean {
  if (!metrics) return false;
  if (condition === "high_cost") return metrics.highCostWarning;
  if (condition === "unregistered_recipe") return metrics.isUnregisteredRecipe;
  if (condition === "no_price") return metrics.isNoPrice;
  return metrics.needsCheck;
}

export function computeMenuKpi(
  menus: MenuItem[],
  costData?: CostSimulationResponse | null,
  salesData?: SalesAnalyticsResponse | null,
): MenuKpiSummary {
  const costMenus: MenuCostSimulationItem[] = costData?.menus ?? [];
  const costById = new Map(costMenus.map((c) => [c.menu_item_id, c]));

  const salesById = new Map<string, { quantity: number; salesAmount: number }>();
  for (const rank of salesData?.menu_rankings ?? []) {
    if (!rank.menu_item_id) continue;
    const prev = salesById.get(rank.menu_item_id) ?? { quantity: 0, salesAmount: 0 };
    salesById.set(rank.menu_item_id, {
      quantity: prev.quantity + rank.quantity,
      salesAmount: prev.salesAmount + Number(rank.sales_amount),
    });
  }

  const rankedSalesSum = Array.from(salesById.values()).reduce((sum, s) => sum + s.salesAmount, 0);
  const netSales = salesData ? Number(salesData.total_net_sales) : 0;
  const totalSalesAmount = netSales > 0 ? netSales : rankedSalesSum;

  const byMenuId = new Map<string, MenuRowMetrics>();
  const contributionItems: {
    id: string;
    name: string;
    quantity: number;
    marginWon: number;
    profitWon: number;
  }[] = [];
  const costedItems: {
    menu: MenuItem;
    cost: MenuCostSimulationItem;
    ratioPercent: number;
    rawRatio: number;
    quantity: number;
  }[] = [];

  const highCostMenus: MenuItem[] = [];
  const unregisteredRecipeMenus: MenuItem[] = [];
  const noPriceMenus: MenuItem[] = [];

  for (const menu of menus) {
    const cost = costById.get(menu.id);
    const sale = salesById.get(menu.id);
    const hasCompleteCost =
      Boolean(cost) &&
      cost!.cost_status === "COMPLETE" &&
      cost!.base_cost_ratio_percent !== null &&
      cost!.base_margin !== null;

    const costRatioPercent = hasCompleteCost
      ? roundOneDecimal(Number(cost!.base_cost_ratio_percent))
      : null;
    const marginWon = hasCompleteCost ? Math.round(Number(cost!.base_margin)) : null;
    const highCostWarning = Boolean(cost?.high_cost_warning);

    const salesSharePercent =
      salesData && totalSalesAmount > 0
        ? ((sale?.salesAmount ?? 0) / totalSalesAmount) * 100
        : null;
    const salesShareBarPx =
      salesSharePercent !== null ? Math.max(0, Math.round(salesSharePercent)) : 0;

    let contributionProfitWon: number | null = null;
    if (
      menu.recipe_status === "COMPLETE" &&
      hasCompleteCost &&
      menu.selling_price !== null &&
      salesData
    ) {
      const unitMargin = Number(menu.selling_price) - Number(cost!.base_recipe_cost);
      const quantity = sale?.quantity ?? 0;
      contributionProfitWon = unitMargin * quantity;
      // 적자 메뉴도 합계에 넣어야 총 공헌이익이 부풀지 않는다.
      contributionItems.push({
        id: menu.id,
        name: menu.name,
        quantity,
        marginWon: Math.round(unitMargin),
        profitWon: contributionProfitWon,
      });
    }

    if (hasCompleteCost && costRatioPercent !== null) {
      costedItems.push({
        menu,
        cost: cost!,
        ratioPercent: costRatioPercent,
        rawRatio: Number(cost!.base_cost_ratio_percent),
        quantity: sale?.quantity ?? 0,
      });
    }

    const isUnregisteredRecipe = menu.recipe_status !== "COMPLETE";
    const isNoPrice = menu.selling_price === null || Number(menu.selling_price) <= 0;

    if (highCostWarning) highCostMenus.push(menu);
    if (isUnregisteredRecipe) unregisteredRecipeMenus.push(menu);
    if (isNoPrice) noPriceMenus.push(menu);

    const needsCheck = highCostWarning || isUnregisteredRecipe || isNoPrice;

    byMenuId.set(menu.id, {
      costRatioPercent,
      marginWon,
      highCostWarning,
      isUnregisteredRecipe,
      isNoPrice,
      salesSharePercent,
      salesShareBarPx,
      contributionProfitWon,
      needsCheck,
    });
  }

  contributionItems.sort((a, b) => b.profitWon - a.profitWon);
  const totalContributionWon =
    salesData && contributionItems.length > 0
      ? contributionItems.reduce((sum, item) => sum + item.profitWon, 0)
      : null;
  const totalContributionManWon =
    totalContributionWon !== null ? Math.round(totalContributionWon / 10000) : null;

  const allContributionItems: MenuContributionDetailRow[] = contributionItems.map((item) => {
    const sharePercent =
      totalContributionWon && totalContributionWon > 0
        ? (item.profitWon / totalContributionWon) * 100
        : 0;
    return {
      menuId: item.id,
      name: item.name,
      quantity: item.quantity,
      marginWon: item.marginWon,
      profitWon: Math.round(item.profitWon),
      profitManWon: Math.round(item.profitWon / 10000),
      sharePercent: roundOneDecimal(sharePercent),
    };
  });

  const groupedContribution =
    contributionItems.length <= 3
      ? contributionItems.map((it) => ({ id: it.id, label: it.name, profitWon: it.profitWon }))
      : [
          ...contributionItems.slice(0, 3).map((it) => ({
            id: it.id,
            label: it.name,
            profitWon: it.profitWon,
          })),
          {
            id: "rest",
            label: `그 외 ${contributionItems.length - 3}개`,
            profitWon: contributionItems.slice(3).reduce((s, it) => s + it.profitWon, 0),
          },
        ];

  const contributionRows: MenuContributionRow[] = groupedContribution.map((item, idx) => {
    const sharePercent =
      totalContributionWon && totalContributionWon > 0
        ? (item.profitWon / totalContributionWon) * 100
        : 0;
    const colorVar = item.id === "rest" ? "var(--kpi-c5)" : STACK_COLORS[idx % 3];
    return {
      id: item.id,
      label: item.label,
      amountWon: Math.round(item.profitWon),
      amountManWon: Math.round(item.profitWon / 10000),
      sharePercent: Number(sharePercent.toFixed(1)),
      roundedSharePercent: Math.round(sharePercent),
      colorVar,
    };
  });

  const contributionSegments = contributionRows.map((row) => ({
    id: row.id,
    flex: Math.max(0.1, row.sharePercent),
    colorVar: row.colorVar,
  }));

  let weightedAvgCostRatio: number | null = null;
  let avgCostLeftPercent = 50;
  let minCostRatio: number | null = null;
  let maxCostRatio: number | null = null;
  let minCostMenuName: string | null = null;
  let maxCostMenuName: string | null = null;
  let maxCostWarning = false;

  const sortedCosted = [...costedItems].sort((a, b) => a.rawRatio - b.rawRatio);

  if (sortedCosted.length > 0) {
    const minItem = sortedCosted[0];
    const maxItem = sortedCosted[sortedCosted.length - 1];
    minCostRatio = minItem.ratioPercent;
    maxCostRatio = maxItem.ratioPercent;
    minCostMenuName = minItem.menu.name;
    maxCostMenuName = maxItem.menu.name;
    maxCostWarning = sortedCosted.some(
      (c) => c.ratioPercent === maxCostRatio && c.cost.high_cost_warning,
    );

    const totalCostedSales = sortedCosted.reduce(
      (sum, c) => sum + Number(c.menu.selling_price ?? 0) * c.quantity,
      0,
    );
    const totalCostedRecipe = sortedCosted.reduce(
      (sum, c) => sum + Number(c.cost.base_recipe_cost) * c.quantity,
      0,
    );

    if (totalCostedSales > 0) {
      weightedAvgCostRatio = (totalCostedRecipe / totalCostedSales) * 100;
    } else {
      const totalQty = sortedCosted.reduce((sum, c) => sum + c.quantity, 0);
      if (totalQty > 0) {
        weightedAvgCostRatio =
          sortedCosted.reduce((sum, c) => sum + c.ratioPercent * c.quantity, 0) / totalQty;
      } else {
        weightedAvgCostRatio =
          sortedCosted.reduce((sum, c) => sum + c.ratioPercent, 0) / sortedCosted.length;
      }
    }

    const span = maxItem.rawRatio - minItem.rawRatio;
    if (span > 0 && weightedAvgCostRatio !== null) {
      avgCostLeftPercent = Math.min(
        100,
        Math.max(0, Math.round(((weightedAvgCostRatio - minItem.rawRatio) / span) * 100)),
      );
    } else {
      avgCostLeftPercent = 50;
    }
  }

  const costDots: MenuCostDot[] = sortedCosted.map((c) => {
    const minRaw = sortedCosted[0].rawRatio;
    const maxRaw = sortedCosted[sortedCosted.length - 1].rawRatio;
    const span = maxRaw - minRaw;
    const leftPercent =
      span > 0 ? Math.min(100, Math.max(0, Math.round(((c.rawRatio - minRaw) / span) * 100))) : 50;
    return {
      menuId: c.menu.id,
      name: c.menu.name,
      ratioPercent: c.ratioPercent,
      leftPercent,
      highCostWarning: c.cost.high_cost_warning,
    };
  });

  const needsCheckIds = new Set<string>([
    ...highCostMenus.map((m) => m.id),
    ...unregisteredRecipeMenus.map((m) => m.id),
    ...noPriceMenus.map((m) => m.id),
  ]);

  let firstAction: MenuCheckAction | null = null;
  if (unregisteredRecipeMenus.length > 0) {
    firstAction = {
      menu: unregisteredRecipeMenus[0],
      label: "레시피 등록 →",
      kind: "RECIPE",
    };
  } else if (noPriceMenus.length > 0) {
    firstAction = {
      menu: noPriceMenus[0],
      label: "가격 입력 →",
      kind: "PRICE",
    };
  } else if (highCostMenus.length > 0) {
    firstAction = {
      menu: highCostMenus[0],
      label: "원가 보기 →",
      kind: "HIGH_COST",
    };
  }

  return {
    totalContributionWon,
    totalContributionManWon,
    contributionSegments,
    contributionRows,
    allContributionItems,
    weightedAvgCostRatio,
    avgCostLeftPercent,
    minCostRatio,
    maxCostRatio,
    minCostMenuName,
    maxCostMenuName,
    maxCostWarning,
    costDots,
    costedMenuCount: costedItems.length,
    totalMenuCount: menus.length,
    highCostCount: highCostMenus.length,
    unregisteredRecipeCount: unregisteredRecipeMenus.length,
    noPriceCount: noPriceMenus.length,
    needsCheckCount: needsCheckIds.size,
    firstAction,
    byMenuId,
  };
}

