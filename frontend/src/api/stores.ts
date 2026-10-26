import { apiRequest } from "./client";
import type {
  AgeBandType,
  Store,
  StoreTable,
  VisitSession,
  VisitStatusType,
  VisitSummary,
} from "../types";

export function fetchStores(): Promise<Store[]> {
  return apiRequest<Store[]>("/stores");
}

export function createStore(payload: {
  name: string;
  timezone?: string;
  business_days?: string;
  opening_hours?: string;
  initial_table_count?: number;
  default_seats?: number;
}): Promise<Store> {
  return apiRequest<Store>("/stores", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateStore(
  storeId: string,
  payload: Partial<{
    name: string;
    timezone: string;
    business_days: string;
    opening_hours: string;
  }>
): Promise<Store> {
  return apiRequest<Store>(`/stores/${storeId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchTables(
  storeId: string,
  includeInactive = false
): Promise<StoreTable[]> {
  const q = includeInactive ? "?include_inactive=true" : "";
  return apiRequest<StoreTable[]>(`/stores/${storeId}/tables${q}`);
}

export function createTable(
  storeId: string,
  payload: {
    name: string;
    seats: number;
    grid_x: number;
    grid_y: number;
    is_active?: boolean;
  }
): Promise<StoreTable> {
  return apiRequest<StoreTable>(`/stores/${storeId}/tables`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTable(
  storeId: string,
  tableId: string,
  payload: Partial<{
    name: string;
    seats: number;
    grid_x: number;
    grid_y: number;
    is_active: boolean;
  }>
): Promise<StoreTable> {
  return apiRequest<StoreTable>(`/stores/${storeId}/tables/${tableId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchVisitSummary(storeId: string): Promise<VisitSummary> {
  return apiRequest<VisitSummary>(`/stores/${storeId}/visits`);
}

export function createVisitSession(
  storeId: string,
  payload: {
    table_id: string;
    party_size: number;
    age_band: AgeBandType;
    notes?: string | null;
  }
): Promise<VisitSession> {
  return apiRequest<VisitSession>(`/stores/${storeId}/visits`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateVisitSession(
  storeId: string,
  visitId: string,
  payload: Partial<{
    party_size: number;
    age_band: AgeBandType;
    status: VisitStatusType;
    notes: string | null;
  }>
): Promise<VisitSession> {
  return apiRequest<VisitSession>(`/stores/${storeId}/visits/${visitId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function seedWesternDemo(
  storeId: string
): Promise<{
  ingredients_created: number;
  menus_created: number;
  receipts_created: number;
}> {
  return apiRequest<{
    ingredients_created: number;
    menus_created: number;
    receipts_created: number;
  }>(`/stores/${storeId}/seed-western-demo`, {
    method: "POST",
  });
}

