export interface Store {
  id: string;
  name: string;
  timezone: string;
  business_days: string | null;
  opening_hours: string | null;
  floor_fixtures: FloorFixture[];
  created_at: string;
  updated_at: string;
}

// 홀 좌표계: 가로 28칸 × 세로 24칸, 1칸 ≈ 34cm. 카운터에서 바라본 방향 (U-31, U-47)
export const FLOOR_COLS = 28;
export const FLOOR_ROWS = 24;

export type FixtureKindType =
  | "ENTRANCE"
  | "COUNTER"
  | "PARTITION"
  | "KITCHEN"
  | "WALL"
  | "SOFA"
  | "PILLAR"
  | "WAITING";

export interface FloorFixture {
  kind: FixtureKindType;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string | null;
}

export type OrientationType = "H" | "V";
export type GenderType = "FEMALE" | "MALE" | "UNRECORDED";
// PROVISIONAL 선택지 (WO-20261105-001 §8, 사장님 확인 필요)
export type PurposeType = "MEAL" | "DATE" | "GATHERING" | "FAMILY" | "COMPANY" | "OTHER";
export type RelationshipType = "ALONE" | "COUPLE" | "FRIENDS" | "FAMILY" | "COWORKERS" | "OTHER";

export interface VisitSlot {
  slot_no: number;
  state: string;
  is_claimed: boolean;
  gender: GenderType;
  age_band: AgeBandType;
  profile_source: "GUEST" | "STAFF" | null;
}

export type RecipeStatusType = "UNREGISTERED" | "PARTIAL" | "COMPLETE";

export interface MenuItem {
  id: string;
  store_id: string;
  name: string;
  selling_price: string | null;
  category: string | null;
  description: string | null;
  is_active: boolean;
  pos_mapping_status: "LINKED" | "UNLINKED_PROVISIONAL";
  recipe_status: RecipeStatusType;
  recipe_item_count: number;
  created_at: string;
  updated_at: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  menu_count: number;
}

export interface MenuDeleteResult {
  result: "DELETED" | "DEACTIVATED";
  menu: MenuItem | null;
}

export type BaseUnitType = "g" | "ml" | "ea";
export type PurchaseUnitType = "kg" | "g" | "L" | "ml" | "ea" | "pack";

export interface Ingredient {
  id: string;
  store_id: string;
  name: string;
  base_unit: BaseUnitType;
  purchase_unit: PurchaseUnitType;
  conversion_factor: string;
  safety_stock: string | null;
  notes: string | null;
  is_active: boolean;
  linked_menu_count: number;
  created_at: string;
  updated_at: string;
}

export interface RecipeItemDetail {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  ingredient_is_active: boolean;
  quantity: string;
  unit: string;
  notes: string | null;
}

export interface RecipeDetail {
  menu_item_id: string;
  menu_name: string;
  version: number;
  status: RecipeStatusType;
  effective_from: string | null;
  updated_at: string | null;
  items: RecipeItemDetail[];
}

export interface IngredientUsage {
  menu_item_id: string;
  menu_name: string;
  menu_is_active: boolean;
  quantity: string;
  unit: string;
  recipe_status: string;
}

export type AgeBandType =
  | "UNRECORDED"
  | "10S"
  | "20S"
  | "30S"
  | "40S"
  | "50S"
  | "50S_PLUS"
  | "60S_PLUS"
  | "MIXED";
export type VisitStatusType = "SEATED" | "PAID" | "LEFT";

export interface VisitSession {
  id: string;
  store_id: string;
  table_id: string;
  table_name: string;
  party_size: number;
  age_band: AgeBandType;
  status: VisitStatusType;
  seated_at: string;
  paid_at: string | null;
  left_at: string | null;
  source: string;
  notes: string | null;
  party_size_source: string;
  opened_by: string;
  closed_reason: string | null;
  purpose: PurposeType | null;
  relationship: RelationshipType | null;
  context_source: "GUEST" | "STAFF" | null;
  slots: VisitSlot[];
}

export interface StoreTable {
  id: string;
  store_id: string;
  name: string;
  seats: number;
  grid_x: number;
  grid_y: number;
  orientation: OrientationType;
  is_active: boolean;
  active_visit: VisitSession | null;
  created_at: string;
  updated_at: string;
}

export interface VisitSummary {
  active_table_count: number;
  active_guest_count: number;
  total_visit_count: number;
  total_guest_count: number;
  sessions: VisitSession[];
}

export type PosModeType = "TOSS_OPEN_API" | "TOSS_PLUGIN" | "CSV_UPLOAD";

export interface IntegrationStatus {
  store_id: string;
  mode: PosModeType;
  connection_status: "UNVERIFIED" | "READY_CSV";
  is_realtime: boolean;
  last_synced_at: string | null;
  latest_data_time: string | null;
  total_orders_count: number;
  net_sales_amount: string;
  net_items_quantity: number;
  unmapped_products: string[];
}

export interface CsvColumnMapping {
  order_id_col: string;
  ordered_at_col: string;
  product_name_col: string;
  quantity_col: string;
  unit_price_col: string;
  status_col: string;
}

export interface CsvPreviewRowError {
  row_number: number;
  reason: string;
  raw_row: Record<string, string>;
}

export interface CsvPreviewValidRow {
  row_number: number;
  external_order_id: string;
  ordered_at: string | null;
  time_basis: "order_time" | "date_only" | "unknown";
  raw_product_name: string;
  menu_item_id: string | null;
  mapping_status: "MAPPED" | "UNMAPPED";
  quantity: number;
  unit_price: string;
  status: "COMPLETED" | "CANCELLED";
}

export interface CsvPreviewResponse {
  batch_id: string;
  file_name: string;
  status: string;
  duplicate_file_warning: boolean;
  rows_total: number;
  rows_valid: number;
  rows_error: number;
  rows_unmapped: number;
  unmapped_product_names: string[];
  latest_sale_time: string | null;
  errors: CsvPreviewRowError[];
  sample_valid_rows: CsvPreviewValidRow[];
}

export interface CsvCommitResponse {
  batch_id: string;
  status: string;
  orders_upserted: number;
  items_recorded: number;
  unmapped_count: number;
  latest_sale_time: string | null;
}

export interface ProductMapping {
  id: string;
  store_id: string;
  external_product_name: string;
  menu_item_id: string;
  menu_name: string;
  retroactive_updated_items: number;
}

export type AdjustmentReasonType = "WASTE" | "SPOILAGE" | "CORRECTION" | "OTHER";
export type StockAlertStatusType = "OK" | "LOW_STOCK" | "NEGATIVE_WARNING";

export interface InventoryReceipt {
  id: string;
  store_id: string;
  ingredient_id: string;
  ingredient_name: string;
  purchase_quantity: string;
  purchase_unit: string;
  base_quantity: string;
  base_unit: string;
  total_cost: string;
  unit_cost_per_purchase: string;
  unit_cost_per_base: string;
  supplier_name: string | null;
  notes: string | null;
  received_at: string;
}

export interface InventoryCount {
  id: string;
  store_id: string;
  ingredient_id: string;
  ingredient_name: string;
  actual_quantity: string;
  base_unit: string;
  notes: string | null;
  counted_at: string;
}

export interface InventoryAdjustment {
  id: string;
  store_id: string;
  ingredient_id: string;
  ingredient_name: string;
  quantity_delta: string;
  base_unit: string;
  reason: AdjustmentReasonType;
  notes: string | null;
  occurred_at: string;
}

export interface IngredientInventoryItem {
  ingredient_id: string;
  ingredient_name: string;
  is_active: boolean;
  base_unit: string;
  purchase_unit: string;
  conversion_factor: string;
  safety_stock: string | null;
  latest_unit_cost_per_purchase: string | null;
  latest_unit_cost_per_base: string | null;
  cost_basis_label: string;
  last_actual_quantity: string | null;
  last_counted_at: string | null;
  receipts_since_count_base: string;
  theoretical_consumption_base: string;
  adjustments_since_count_base: string;
  estimated_quantity: string;
  stock_status: StockAlertStatusType;
}

export interface SalesHourlyBucket {
  hour: number;
  quantity: number;
  sales_amount: string;
}

export interface MenuSalesRankItem {
  menu_item_id: string | null;
  menu_name: string;
  mapping_status: "MAPPED" | "UNMAPPED";
  quantity: number;
  sales_amount: string;
}

export interface SalesAnalyticsResponse {
  store_id: string;
  total_completed_orders: number;
  total_quantity: number;
  total_net_sales: string;
  known_hour_quantity: number;
  unknown_hour_quantity: number;
  hourly_buckets: SalesHourlyBucket[];
  menu_rankings: MenuSalesRankItem[];
}

export type MenuCostStatusType = "COMPLETE" | "NO_RECIPE" | "INCOMPLETE_COST";

export interface MenuCostIngredientBreakdown {
  ingredient_id: string;
  ingredient_name: string;
  quantity: string;
  base_unit: string;
  base_unit_cost: string | null;
  simulated_unit_cost: string | null;
  base_line_cost: string | null;
  simulated_line_cost: string | null;
}

export interface MenuCostSimulationItem {
  menu_item_id: string;
  menu_name: string;
  category: string | null;
  selling_price: string | null;
  cost_status: MenuCostStatusType;
  missing_cost_ingredients: string[];
  base_recipe_cost: string;
  simulated_recipe_cost: string;
  cost_delta: string;
  base_margin: string | null;
  simulated_margin: string | null;
  base_cost_ratio_percent: string | null;
  simulated_cost_ratio_percent: string | null;
  high_cost_warning: boolean;
  breakdown: MenuCostIngredientBreakdown[];
}

export interface CostSimulationResponse {
  store_id: string;
  cost_basis_label: string;
  global_change_percent: string;
  menus: MenuCostSimulationItem[];
}

export interface SalesOrderItem {
  id: string;
  raw_product_name: string;
  menu_item_id: string | null;
  menu_name: string | null;
  mapping_status: "MAPPED" | "UNMAPPED";
  quantity: number;
  unit_price: string;
  line_amount: string;
}

export interface SalesOrder {
  id: string;
  store_id: string;
  external_order_id: string;
  ordered_at: string | null;
  time_basis: string;
  order_status: "COMPLETED" | "CANCELLED";
  total_quantity: number;
  total_amount: string;
  source_mode: string;
  items: SalesOrderItem[];
}

export interface SalesOrdersListResponse {
  store_id: string;
  pos_mode: PosModeType;
  can_manual_edit: boolean;
  mode_notice: string;
  orders: SalesOrder[];
}

export interface ApiFieldError {
  field: string;
  message: string;
}

// RFC 9457 problem+json. code와 errors는 확장 필드다 (API-004)
export interface ApiErrorBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  errors: ApiFieldError[];
}

// 월별 손익표 (WO-20261111-002). 금액은 원 단위 정수, 비율은 소수 1자리 문자열.
export interface PnlLine {
  code: string;
  label: string;
  amount: number;
  source: "auto" | "manual";
  ratio_percent: string | null;
}

export interface PnlResponse {
  store_id: string;
  month: string;
  card_fee_percent: string;
  revenue: PnlLine;
  expenses: PnlLine[];
  total_expenses: number;
  operating_profit: number;
  operating_margin_percent: string | null;
  trend: { month: string; revenue: number; total_expenses: number; operating_profit: number }[];
}

export interface PnlExpensesUpdate {
  items: { code: string; label?: string | null; amount: number }[];
  card_fee_percent?: string | null;
}
