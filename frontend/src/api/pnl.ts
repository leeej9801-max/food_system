import { apiRequest } from "./client";
import { pnlSchema } from "./schemas";
import type { PnlExpensesUpdate, PnlResponse } from "../types";

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
