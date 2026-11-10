import { apiRequest } from "./client";
import { costSimulationSchema, salesAnalyticsSchema } from "./schemas";
import type { CostSimulationResponse, SalesAnalyticsResponse } from "../types";

export function fetchSalesAnalytics(
  storeId: string
): Promise<SalesAnalyticsResponse> {
  return apiRequest(salesAnalyticsSchema, `/stores/${storeId}/analytics/sales`
  );
}

export function simulateMenuCosts(
  storeId: string,
  payload: {
    global_change_percent: number;
    ingredient_change_percents?: Record<string, number>;
  }
): Promise<CostSimulationResponse> {
  return apiRequest(costSimulationSchema, `/stores/${storeId}/analytics/costing`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}
