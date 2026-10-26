import { apiRequest } from "./client";
import type { CostSimulationResponse, SalesAnalyticsResponse } from "../types";

export function fetchSalesAnalytics(
  storeId: string
): Promise<SalesAnalyticsResponse> {
  return apiRequest<SalesAnalyticsResponse>(
    `/stores/${storeId}/analytics/sales`
  );
}

export function simulateMenuCosts(
  storeId: string,
  payload: {
    global_change_percent: number;
    ingredient_change_percents?: Record<string, number>;
  }
): Promise<CostSimulationResponse> {
  return apiRequest<CostSimulationResponse>(
    `/stores/${storeId}/analytics/costing`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}
