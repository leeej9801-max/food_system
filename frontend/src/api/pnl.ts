import { apiRequest } from "./client";
import { pnlDayDetailSchema, pnlSchema } from "./schemas";
import type { PnlDayDetail, PnlExpensesUpdate, PnlGoal, PnlResponse } from "../types";

export function fetchPnl(storeId: string, month: string): Promise<PnlResponse> {
  return apiRequest(pnlSchema, `/stores/${storeId}/pnl?month=${month}`);
}

export function savePnlExpenses(
  storeId: string,
  month: string,
  payload: PnlExpensesUpdate
): Promise<PnlResponse> {
  return apiRequest(pnlSchema, `/stores/${storeId}/pnl/${month}/expenses`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function savePnlGoal(storeId: string, month: string, payload: Pick<PnlGoal, "revenue_target" | "profit_target">): Promise<PnlResponse> {
  return apiRequest(pnlSchema, `/stores/${storeId}/pnl/${month}/goal`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchPnlDay(storeId: string, day: string): Promise<PnlDayDetail> {
  return apiRequest(pnlDayDetailSchema, `/stores/${storeId}/pnl/days/${day}`);
}
