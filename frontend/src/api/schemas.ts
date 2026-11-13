// 서버 응답 검증 스키마 (TS-010). zod는 이 폴더 안에서만 쓴다.
// 각 스키마를 `z.ZodType<타입>`으로 선언해, ../types의 타입과 어긋나면 typecheck가 실패한다.
import { z } from "zod";
import type * as T from "../types";

const str = z.string();
const num = z.number();
const bool = z.boolean();
const nstr = z.string().nullable();

const ageBand = z.enum([
  "UNRECORDED",
  "10S",
  "20S",
  "30S",
  "40S",
  "50S",
  "50S_PLUS",
  "60S_PLUS",
  "MIXED",
]);
const source = z.enum(["GUEST", "STAFF"]).nullable();
const recipeStatus = z.enum(["UNREGISTERED", "PARTIAL", "COMPLETE"]);
const mappingStatus = z.enum(["MAPPED", "UNMAPPED"]);
const orderStatus = z.enum(["COMPLETED", "CANCELLED"]);
const posMode = z.enum(["TOSS_OPEN_API", "TOSS_PLUGIN", "CSV_UPLOAD"]);

export const problemSchema: z.ZodType<T.ApiErrorBody> = z.object({
  type: str,
  title: str,
  status: num,
  detail: str,
  instance: str,
  code: str,
  errors: z.array(z.object({ field: str, message: str })),
});

export const storeSchema: z.ZodType<T.Store> = z.object({
  id: str,
  name: str,
  timezone: str,
  business_days: nstr,
  opening_hours: nstr,
  floor_fixtures: z.array(
    z.object({
      kind: z.enum(["ENTRANCE", "COUNTER", "PARTITION", "KITCHEN", "WALL", "SOFA", "PILLAR", "WAITING"]),
      x: num,
      y: num,
      w: num,
      h: num,
      label: nstr,
    })
  ),
  created_at: str,
  updated_at: str,
});

export const visitSessionSchema: z.ZodType<T.VisitSession> = z.object({
  id: str,
  store_id: str,
  table_id: str,
  table_name: str,
  party_size: num,
  age_band: ageBand,
  status: z.enum(["SEATED", "PAID", "LEFT"]),
  seated_at: str,
  paid_at: nstr,
  left_at: nstr,
  source: str,
  notes: nstr,
  party_size_source: str,
  opened_by: str,
  closed_reason: nstr,
  purpose: z.enum(["MEAL", "DATE", "GATHERING", "FAMILY", "COMPANY", "OTHER"]).nullable(),
  relationship: z.enum(["ALONE", "COUPLE", "FRIENDS", "FAMILY", "COWORKERS", "OTHER"]).nullable(),
  context_source: source,
  slots: z.array(
    z.object({
      slot_no: num,
      state: str,
      is_claimed: bool,
      gender: z.enum(["FEMALE", "MALE", "UNRECORDED"]),
      age_band: ageBand,
      profile_source: source,
    })
  ),
});

export const storeTableSchema: z.ZodType<T.StoreTable> = z.object({
  id: str,
  store_id: str,
  name: str,
  seats: num,
  grid_x: num,
  grid_y: num,
  orientation: z.enum(["H", "V"]),
  is_active: bool,
  active_visit: visitSessionSchema.nullable(),
  created_at: str,
  updated_at: str,
});

export const visitSummarySchema: z.ZodType<T.VisitSummary> = z.object({
  active_table_count: num,
  active_guest_count: num,
  total_visit_count: num,
  total_guest_count: num,
  sessions: z.array(visitSessionSchema),
});

export const seedResultSchema = z.object({
  ingredients_created: num,
  menus_created: num,
  receipts_created: num,
});

export const menuItemSchema: z.ZodType<T.MenuItem> = z.object({
  id: str,
  store_id: str,
  name: str,
  selling_price: nstr,
  category: nstr,
  description: nstr,
  is_active: bool,
  pos_mapping_status: z.enum(["LINKED", "UNLINKED_PROVISIONAL"]),
  recipe_status: recipeStatus,
  recipe_item_count: num,
  created_at: str,
  updated_at: str,
});

export const ingredientSchema: z.ZodType<T.Ingredient> = z.object({
  id: str,
  store_id: str,
  name: str,
  base_unit: z.enum(["g", "ml", "ea"]),
  purchase_unit: z.enum(["kg", "g", "L", "ml", "ea", "pack"]),
  conversion_factor: str,
  safety_stock: nstr,
  notes: nstr,
  is_active: bool,
  linked_menu_count: num,
  created_at: str,
  updated_at: str,
});

export const ingredientUsageSchema: z.ZodType<T.IngredientUsage> = z.object({
  menu_item_id: str,
  menu_name: str,
  menu_is_active: bool,
  quantity: str,
  unit: str,
  recipe_status: str,
});

export const recipeDetailSchema: z.ZodType<T.RecipeDetail> = z.object({
  menu_item_id: str,
  menu_name: str,
  version: num,
  status: recipeStatus,
  effective_from: nstr,
  updated_at: nstr,
  items: z.array(
    z.object({
      id: str,
      ingredient_id: str,
      ingredient_name: str,
      ingredient_is_active: bool,
      quantity: str,
      unit: str,
      notes: nstr,
    })
  ),
});

export const integrationStatusSchema: z.ZodType<T.IntegrationStatus> = z.object({
  store_id: str,
  mode: posMode,
  connection_status: z.enum(["UNVERIFIED", "READY_CSV"]),
  is_realtime: bool,
  last_synced_at: nstr,
  latest_data_time: nstr,
  total_orders_count: num,
  net_sales_amount: str,
  net_items_quantity: num,
  unmapped_products: z.array(str),
});

export const sampleCsvSchema = z.object({ file_name: str, csv_text: str });

export const csvPreviewSchema: z.ZodType<T.CsvPreviewResponse> = z.object({
  batch_id: str,
  file_name: str,
  status: str,
  duplicate_file_warning: bool,
  rows_total: num,
  rows_valid: num,
  rows_error: num,
  rows_unmapped: num,
  unmapped_product_names: z.array(str),
  latest_sale_time: nstr,
  errors: z.array(z.object({ row_number: num, reason: str, raw_row: z.record(str, str) })),
  sample_valid_rows: z.array(
    z.object({
      row_number: num,
      external_order_id: str,
      ordered_at: nstr,
      time_basis: z.enum(["order_time", "date_only", "unknown"]),
      raw_product_name: str,
      menu_item_id: nstr,
      mapping_status: mappingStatus,
      quantity: num,
      unit_price: str,
      status: orderStatus,
    })
  ),
});

export const csvCommitSchema: z.ZodType<T.CsvCommitResponse> = z.object({
  batch_id: str,
  status: str,
  orders_upserted: num,
  items_recorded: num,
  unmapped_count: num,
  latest_sale_time: nstr,
});

export const productMappingSchema: z.ZodType<T.ProductMapping> = z.object({
  id: str,
  store_id: str,
  external_product_name: str,
  menu_item_id: str,
  menu_name: str,
  retroactive_updated_items: num,
});

export const salesOrderSchema: z.ZodType<T.SalesOrder> = z.object({
  id: str,
  store_id: str,
  external_order_id: str,
  ordered_at: nstr,
  time_basis: str,
  order_status: orderStatus,
  total_quantity: num,
  total_amount: str,
  source_mode: str,
  items: z.array(
    z.object({
      id: str,
      raw_product_name: str,
      menu_item_id: nstr,
      menu_name: nstr,
      mapping_status: mappingStatus,
      quantity: num,
      unit_price: str,
      line_amount: str,
    })
  ),
});

export const salesOrdersListSchema: z.ZodType<T.SalesOrdersListResponse> = z.object({
  store_id: str,
  pos_mode: posMode,
  can_manual_edit: bool,
  mode_notice: str,
  orders: z.array(salesOrderSchema),
});

export const inventoryReceiptSchema: z.ZodType<T.InventoryReceipt> = z.object({
  id: str,
  store_id: str,
  ingredient_id: str,
  ingredient_name: str,
  purchase_quantity: str,
  purchase_unit: str,
  base_quantity: str,
  base_unit: str,
  total_cost: str,
  unit_cost_per_purchase: str,
  unit_cost_per_base: str,
  supplier_name: nstr,
  notes: nstr,
  received_at: str,
});

export const inventoryCountSchema: z.ZodType<T.InventoryCount> = z.object({
  id: str,
  store_id: str,
  ingredient_id: str,
  ingredient_name: str,
  actual_quantity: str,
  base_unit: str,
  notes: nstr,
  counted_at: str,
});

export const inventoryAdjustmentSchema: z.ZodType<T.InventoryAdjustment> = z.object({
  id: str,
  store_id: str,
  ingredient_id: str,
  ingredient_name: str,
  quantity_delta: str,
  base_unit: str,
  reason: z.enum(["WASTE", "SPOILAGE", "CORRECTION", "OTHER"]),
  notes: nstr,
  occurred_at: str,
});

export const inventoryItemSchema: z.ZodType<T.IngredientInventoryItem> = z.object({
  ingredient_id: str,
  ingredient_name: str,
  is_active: bool,
  base_unit: str,
  purchase_unit: str,
  conversion_factor: str,
  safety_stock: nstr,
  latest_unit_cost_per_purchase: nstr,
  latest_unit_cost_per_base: nstr,
  cost_basis_label: str,
  last_actual_quantity: nstr,
  last_counted_at: nstr,
  receipts_since_count_base: str,
  theoretical_consumption_base: str,
  adjustments_since_count_base: str,
  estimated_quantity: str,
  stock_status: z.enum(["OK", "LOW_STOCK", "NEGATIVE_WARNING"]),
});

export const salesAnalyticsSchema: z.ZodType<T.SalesAnalyticsResponse> = z.object({
  store_id: str,
  total_completed_orders: num,
  total_quantity: num,
  total_net_sales: str,
  known_hour_quantity: num,
  unknown_hour_quantity: num,
  hourly_buckets: z.array(z.object({ hour: num, quantity: num, sales_amount: str })),
  menu_rankings: z.array(
    z.object({
      menu_item_id: nstr,
      menu_name: str,
      mapping_status: mappingStatus,
      quantity: num,
      sales_amount: str,
    })
  ),
});

export const costSimulationSchema: z.ZodType<T.CostSimulationResponse> = z.object({
  store_id: str,
  cost_basis_label: str,
  global_change_percent: str,
  menus: z.array(
    z.object({
      menu_item_id: str,
      menu_name: str,
      category: nstr,
      selling_price: nstr,
      cost_status: z.enum(["COMPLETE", "NO_RECIPE", "INCOMPLETE_COST"]),
      missing_cost_ingredients: z.array(str),
      base_recipe_cost: str,
      simulated_recipe_cost: str,
      cost_delta: str,
      base_margin: nstr,
      simulated_margin: nstr,
      base_cost_ratio_percent: nstr,
      simulated_cost_ratio_percent: nstr,
      high_cost_warning: bool,
      breakdown: z.array(
        z.object({
          ingredient_id: str,
          ingredient_name: str,
          quantity: str,
          base_unit: str,
          base_unit_cost: nstr,
          simulated_unit_cost: nstr,
          base_line_cost: nstr,
          simulated_line_cost: nstr,
        })
      ),
    })
  ),
});

const pnlLineSchema = z.object({
  code: str,
  label: str,
  amount: num,
  source: z.enum(["auto", "manual"]),
  ratio_percent: nstr,
});

export const pnlSchema: z.ZodType<T.PnlResponse> = z.object({
  store_id: str,
  month: str,
  card_fee_percent: str,
  revenue: pnlLineSchema,
  expenses: z.array(pnlLineSchema),
  total_expenses: num,
  operating_profit: num,
  operating_margin_percent: nstr,
  trend: z.array(
    z.object({ month: str, revenue: num, total_expenses: num, operating_profit: num })
  ),
});
