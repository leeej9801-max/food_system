import { z } from "zod";
import { apiRequest } from "./client";
import { seedResultSchema, storeSchema, storeTableSchema, visitSessionSchema, visitSummarySchema } from "./schemas";
import type {
  AgeBandType,
  GenderType,
  OrientationType,
  PurposeType,
  RelationshipType,
  Store,
  StoreTable,
  VisitSession,
  VisitStatusType,
  VisitSummary,
} from "../types";

export function fetchStores(): Promise<Store[]> {
  return apiRequest(z.array(storeSchema), "/stores");
}

export function createStore(payload: {
  name: string;
  timezone?: string;
  business_days?: string;
  opening_hours?: string;
  initial_table_count?: number;
  default_seats?: number;
}): Promise<Store> {
  return apiRequest(storeSchema, "/stores", {
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
  return apiRequest(storeSchema, `/stores/${storeId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchTables(
  storeId: string,
  includeInactive = false
): Promise<StoreTable[]> {
  const q = includeInactive ? "?include_inactive=true" : "";
  return apiRequest(z.array(storeTableSchema), `/stores/${storeId}/tables${q}`);
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
  return apiRequest(storeTableSchema, `/stores/${storeId}/tables`, {
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
    orientation: OrientationType;
    is_active: boolean;
  }>
): Promise<StoreTable> {
  return apiRequest(storeTableSchema, `/stores/${storeId}/tables/${tableId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchVisitSummary(storeId: string): Promise<VisitSummary> {
  return apiRequest(visitSummarySchema, `/stores/${storeId}/visits`);
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
  return apiRequest(visitSessionSchema, `/stores/${storeId}/visits`, {
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
    purpose: PurposeType;
    relationship: RelationshipType;
  }>
): Promise<VisitSession> {
  return apiRequest(visitSessionSchema, `/stores/${storeId}/visits/${visitId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateVisitSlot(
  storeId: string,
  visitId: string,
  slotNo: number,
  payload: Partial<{ gender: GenderType; age_band: AgeBandType }>
): Promise<VisitSession> {
  return apiRequest(visitSessionSchema, `/stores/${storeId}/visits/${visitId}/slots/${slotNo}`, {
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
  return apiRequest(seedResultSchema, `/stores/${storeId}/seed-western-demo`, {
    method: "POST",
  });
}

