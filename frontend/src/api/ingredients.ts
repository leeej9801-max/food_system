import { z } from "zod";
import { apiRequest } from "./client";
import {
  ingredientInsightsSchema,
  ingredientSchema,
  ingredientUsageSchema,
  recipeDetailSchema,
} from "./schemas";
import type {
  Ingredient,
  IngredientInsights,
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
  return apiRequest(z.array(ingredientSchema), `/stores/${storeId}/ingredients${query ? `?${query}` : ""}`);
}

export function createIngredient(
  storeId: string,
  payload: {
    name: string;
    unit: PurchaseUnitType;
    safety_stock: number | null;
    notes: string | null;
    is_active: boolean;
  }
): Promise<Ingredient> {
  return apiRequest(ingredientSchema, `/stores/${storeId}/ingredients`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateIngredient(
  storeId: string,
  ingredientId: string,
  payload: Partial<{
    name: string;
    unit: PurchaseUnitType;
    safety_stock: number | null;
    notes: string | null;
    is_active: boolean;
  }>
): Promise<Ingredient> {
  return apiRequest(ingredientSchema, `/stores/${storeId}/ingredients/${ingredientId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchIngredientUsages(
  storeId: string,
  ingredientId: string
): Promise<IngredientUsage[]> {
  return apiRequest(z.array(ingredientUsageSchema), `/stores/${storeId}/ingredients/${ingredientId}/usages`
  );
}

export function fetchMenuRecipe(storeId: string, menuId: string): Promise<RecipeDetail> {
  return apiRequest(recipeDetailSchema, `/stores/${storeId}/menus/${menuId}/recipe`);
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
  return apiRequest(recipeDetailSchema, `/stores/${storeId}/menus/${menuId}/recipe`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchIngredientInsights(storeId: string): Promise<IngredientInsights> {
  return apiRequest(ingredientInsightsSchema, `/stores/${storeId}/ingredients/insights`);
}
