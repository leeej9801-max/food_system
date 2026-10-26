import { apiRequest } from "./client";
import type {
  BaseUnitType,
  Ingredient,
  IngredientUsage,
  PurchaseUnitType,
  RecipeDetail,
} from "../types";

export interface IngredientListFilter {
  q?: string;
  status?: "all" | "active" | "inactive";
}

export function fetchIngredients(
  storeId: string,
  filter: IngredientListFilter = {}
): Promise<Ingredient[]> {
  const params = new URLSearchParams();
  if (filter.q && filter.q.trim()) {
    params.set("q", filter.q.trim());
  }
  if (filter.status) {
    params.set("status", filter.status);
  }
  const query = params.toString();
  return apiRequest<Ingredient[]>(`/stores/${storeId}/ingredients${query ? `?${query}` : ""}`);
}

export function createIngredient(
  storeId: string,
  payload: {
    name: string;
    base_unit: BaseUnitType;
    purchase_unit: PurchaseUnitType;
    conversion_factor: number;
    safety_stock: number | null;
    notes: string | null;
    is_active: boolean;
  }
): Promise<Ingredient> {
  return apiRequest<Ingredient>(`/stores/${storeId}/ingredients`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateIngredient(
  storeId: string,
  ingredientId: string,
  payload: Partial<{
    name: string;
    base_unit: BaseUnitType;
    purchase_unit: PurchaseUnitType;
    conversion_factor: number;
    safety_stock: number | null;
    notes: string | null;
    is_active: boolean;
  }>
): Promise<Ingredient> {
  return apiRequest<Ingredient>(`/stores/${storeId}/ingredients/${ingredientId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchIngredientUsages(
  storeId: string,
  ingredientId: string
): Promise<IngredientUsage[]> {
  return apiRequest<IngredientUsage[]>(
    `/stores/${storeId}/ingredients/${ingredientId}/usages`
  );
}

export function fetchMenuRecipe(storeId: string, menuId: string): Promise<RecipeDetail> {
  return apiRequest<RecipeDetail>(`/stores/${storeId}/menus/${menuId}/recipe`);
}

export function upsertMenuRecipe(
  storeId: string,
  menuId: string,
  payload: {
    status: "COMPLETE" | "PARTIAL";
    items: Array<{
      ingredient_id: string;
      quantity: number;
      notes?: string | null;
    }>;
  }
): Promise<RecipeDetail> {
  return apiRequest<RecipeDetail>(`/stores/${storeId}/menus/${menuId}/recipe`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
