import { apiRequest } from "./client";
import type {
  AdjustmentReasonType,
  IngredientInventoryItem,
  InventoryAdjustment,
  InventoryCount,
  InventoryReceipt,
} from "../types";

export function fetchInventorySummary(
  storeId: string,
  includeInactive = false
): Promise<IngredientInventoryItem[]> {
  return apiRequest<IngredientInventoryItem[]>(
    `/stores/${storeId}/inventory/summary?include_inactive=${includeInactive}`
  );
}

export function fetchReceipts(
  storeId: string,
  ingredientId?: string
): Promise<InventoryReceipt[]> {
  const q = ingredientId ? `?ingredient_id=${encodeURIComponent(ingredientId)}` : "";
  return apiRequest<InventoryReceipt[]>(`/stores/${storeId}/inventory/receipts${q}`);
}

export function createReceipt(
  storeId: string,
  payload: {
    ingredient_id: string;
    purchase_quantity: number;
    total_cost: number;
    supplier_name?: string | null;
    notes?: string | null;
  }
): Promise<InventoryReceipt> {
  return apiRequest<InventoryReceipt>(`/stores/${storeId}/inventory/receipts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchCounts(
  storeId: string,
  ingredientId?: string
): Promise<InventoryCount[]> {
  const q = ingredientId ? `?ingredient_id=${encodeURIComponent(ingredientId)}` : "";
  return apiRequest<InventoryCount[]>(`/stores/${storeId}/inventory/counts${q}`);
}

export function createCount(
  storeId: string,
  payload: {
    ingredient_id: string;
    actual_quantity: number;
    notes?: string | null;
  }
): Promise<InventoryCount> {
  return apiRequest<InventoryCount>(`/stores/${storeId}/inventory/counts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createAdjustment(
  storeId: string,
  payload: {
    ingredient_id: string;
    quantity_delta: number;
    reason: AdjustmentReasonType;
    notes?: string | null;
  }
): Promise<InventoryAdjustment> {
  return apiRequest<InventoryAdjustment>(
    `/stores/${storeId}/inventory/adjustments`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}
