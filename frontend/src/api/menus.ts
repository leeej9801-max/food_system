import { apiRequest } from "./client";
import type { MenuItem } from "../types";

export interface MenuListFilter {
  q?: string;
  category?: string;
  status?: "all" | "active" | "inactive";
}

export function fetchMenus(storeId: string, filter: MenuListFilter): Promise<MenuItem[]> {
  const params = new URLSearchParams();
  if (filter.q && filter.q.trim()) {
    params.set("q", filter.q.trim());
  }
  if (filter.category && filter.category.trim()) {
    params.set("category", filter.category.trim());
  }
  if (filter.status) {
    params.set("status", filter.status);
  }
  const query = params.toString();
  return apiRequest<MenuItem[]>(`/stores/${storeId}/menus${query ? `?${query}` : ""}`);
}

export function createMenu(
  storeId: string,
  payload: {
    name: string;
    selling_price: number | null;
    category: string | null;
    description: string | null;
    is_active: boolean;
  }
): Promise<MenuItem> {
  return apiRequest<MenuItem>(`/stores/${storeId}/menus`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMenu(
  storeId: string,
  menuId: string,
  payload: Partial<{
    name: string;
    selling_price: number | null;
    category: string | null;
    description: string | null;
    is_active: boolean;
  }>
): Promise<MenuItem> {
  return apiRequest<MenuItem>(`/stores/${storeId}/menus/${menuId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
