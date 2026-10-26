from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StoreCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    timezone: str = Field(default="Asia/Seoul", min_length=1, max_length=64)
    business_days: str | None = Field(default="월,화,수,목,금,토", max_length=64)
    opening_hours: str | None = Field(default="11:00-21:00", max_length=64)
    initial_table_count: int = Field(default=6, ge=0, le=50)
    default_seats: int = Field(default=4, ge=1, le=20)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("매장명은 공백만으로 입력할 수 없습니다.")
        return trimmed


class StoreUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    business_days: str | None = Field(default=None, max_length=64)
    opening_hours: str | None = Field(default=None, max_length=64)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("매장명은 공백만으로 입력할 수 없습니다.")
        return trimmed


class StoreResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    timezone: str
    business_days: str | None
    opening_hours: str | None
    created_at: datetime
    updated_at: datetime


class MenuCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    selling_price: Decimal | None = Field(default=None, ge=Decimal(0), le=Decimal(99999999))
    category: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool = Field(default=True)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("메뉴명은 필수이며 공백만 입력할 수 없습니다.")
        return trimmed

    @field_validator("category", "description")
    @classmethod
    def strip_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        return trimmed if trimmed else None


class MenuUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    selling_price: Decimal | None = Field(default=None, ge=Decimal(0), le=Decimal(99999999))
    category: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=500)
    is_active: bool | None = Field(default=None)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("메뉴명은 공백만 입력할 수 없습니다.")
        return trimmed

    @field_validator("category", "description")
    @classmethod
    def strip_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        return trimmed if trimmed else None


class MenuResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    store_id: str
    name: str
    selling_price: Decimal | None
    category: str | None
    description: str | None
    is_active: bool
    pos_mapping_status: Literal["LINKED", "UNLINKED_PROVISIONAL"] = "UNLINKED_PROVISIONAL"
    recipe_status: Literal["UNREGISTERED", "PARTIAL", "COMPLETE"] = "UNREGISTERED"
    recipe_item_count: int = 0
    created_at: datetime
    updated_at: datetime


BaseUnitType = Literal["g", "ml", "ea"]
PurchaseUnitType = Literal["kg", "g", "L", "ml", "ea", "pack"]


class IngredientCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    base_unit: BaseUnitType = Field(default="g")
    purchase_unit: PurchaseUnitType = Field(default="kg")
    conversion_factor: Decimal = Field(default=Decimal(1000), gt=Decimal(0), le=Decimal(1000000))
    safety_stock: Decimal | None = Field(default=None, ge=Decimal(0), le=Decimal(100000000))
    notes: str | None = Field(default=None, max_length=500)
    is_active: bool = Field(default=True)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("식자재명은 필수이며 공백만 입력할 수 없습니다.")
        return trimmed

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        return trimmed if trimmed else None


class IngredientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    base_unit: BaseUnitType | None = Field(default=None)
    purchase_unit: PurchaseUnitType | None = Field(default=None)
    conversion_factor: Decimal | None = Field(default=None, gt=Decimal(0), le=Decimal(1000000))
    safety_stock: Decimal | None = Field(default=None, ge=Decimal(0), le=Decimal(100000000))
    notes: str | None = Field(default=None, max_length=500)
    is_active: bool | None = Field(default=None)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("식자재명은 공백만 입력할 수 없습니다.")
        return trimmed

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        return trimmed if trimmed else None


class IngredientResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    store_id: str
    name: str
    base_unit: str
    purchase_unit: str
    conversion_factor: Decimal
    safety_stock: Decimal | None
    notes: str | None
    is_active: bool
    linked_menu_count: int = 0
    created_at: datetime
    updated_at: datetime


class RecipeItemInput(BaseModel):
    ingredient_id: str = Field(..., min_length=1)
    quantity: Decimal = Field(..., gt=Decimal(0), le=Decimal(1000000))
    notes: str | None = Field(default=None, max_length=200)


class RecipeUpsertRequest(BaseModel):
    status: Literal["COMPLETE", "PARTIAL"] = Field(default="COMPLETE")
    items: list[RecipeItemInput] = Field(default_factory=list)


class RecipeItemResponse(BaseModel):
    id: str
    ingredient_id: str
    ingredient_name: str
    ingredient_is_active: bool
    quantity: Decimal
    unit: str
    notes: str | None


class RecipeResponse(BaseModel):
    menu_item_id: str
    menu_name: str
    version: int
    status: Literal["UNREGISTERED", "PARTIAL", "COMPLETE"]
    effective_from: datetime | None
    updated_at: datetime | None
    items: list[RecipeItemResponse]


class IngredientUsageItem(BaseModel):
    menu_item_id: str
    menu_name: str
    menu_is_active: bool
    quantity: Decimal
    unit: str
    recipe_status: str


AgeBandType = Literal[
    "UNRECORDED",
    "10S",
    "20S",
    "30S",
    "40S",
    "50S",
    "50S_PLUS",
    "60S_PLUS",
    "MIXED",
]
VisitStatusType = Literal["SEATED", "PAID", "LEFT"]


class VisitSessionResponse(BaseModel):
    id: str
    store_id: str
    table_id: str
    table_name: str
    party_size: int
    age_band: str
    status: VisitStatusType
    seated_at: datetime
    paid_at: datetime | None
    left_at: datetime | None
    source: str
    notes: str | None


class StoreTableCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    seats: int = Field(default=4, ge=1, le=20)
    grid_x: int = Field(default=0, ge=0, le=11)
    grid_y: int = Field(default=0, ge=0, le=7)
    is_active: bool = Field(default=True)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("테이블명은 필수입니다.")
        return trimmed


class StoreTableUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    seats: int | None = Field(default=None, ge=1, le=20)
    grid_x: int | None = Field(default=None, ge=0, le=11)
    grid_y: int | None = Field(default=None, ge=0, le=7)
    is_active: bool | None = Field(default=None)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("테이블명은 공백만 입력할 수 없습니다.")
        return trimmed


class StoreTableResponse(BaseModel):
    id: str
    store_id: str
    name: str
    seats: int
    grid_x: int
    grid_y: int
    is_active: bool
    active_visit: VisitSessionResponse | None = None
    created_at: datetime
    updated_at: datetime


class VisitSessionCreate(BaseModel):
    table_id: str = Field(..., min_length=1)
    party_size: int = Field(..., ge=1, le=50)
    age_band: AgeBandType = Field(default="UNRECORDED")
    notes: str | None = Field(default=None, max_length=200)


class VisitSessionUpdate(BaseModel):
    party_size: int | None = Field(default=None, ge=1, le=50)
    age_band: AgeBandType | None = Field(default=None)
    status: VisitStatusType | None = Field(default=None)
    notes: str | None = Field(default=None, max_length=200)


class VisitSummaryResponse(BaseModel):
    active_table_count: int
    active_guest_count: int
    total_visit_count: int
    total_guest_count: int
    sessions: list[VisitSessionResponse]


PosModeType = Literal["TOSS_OPEN_API", "TOSS_PLUGIN", "CSV_UPLOAD"]


class PosModeUpdateRequest(BaseModel):
    mode: PosModeType


class IntegrationStatusResponse(BaseModel):
    store_id: str
    mode: PosModeType
    connection_status: Literal["UNVERIFIED", "READY_CSV"]
    is_realtime: bool = False
    last_synced_at: datetime | None
    latest_data_time: datetime | None
    total_orders_count: int
    net_sales_amount: Decimal
    net_items_quantity: int
    unmapped_products: list[str]


class CsvColumnMapping(BaseModel):
    order_id_col: str = Field(default="order_id")
    ordered_at_col: str = Field(default="ordered_at")
    product_name_col: str = Field(default="menu_name")
    quantity_col: str = Field(default="quantity")
    unit_price_col: str = Field(default="unit_price")
    status_col: str = Field(default="status")


class CsvPreviewRequest(BaseModel):
    file_name: str = Field(default="sales_export.csv", min_length=1, max_length=200)
    csv_text: str = Field(..., min_length=1)
    mapping: CsvColumnMapping = Field(default_factory=CsvColumnMapping)


class CsvPreviewRowError(BaseModel):
    row_number: int
    reason: str
    raw_row: dict[str, str]


class CsvPreviewValidRow(BaseModel):
    row_number: int
    external_order_id: str
    ordered_at: datetime | None
    time_basis: Literal["order_time", "date_only", "unknown"]
    raw_product_name: str
    menu_item_id: str | None
    mapping_status: Literal["MAPPED", "UNMAPPED"]
    quantity: int
    unit_price: Decimal
    status: Literal["COMPLETED", "CANCELLED"]


class CsvPreviewResponse(BaseModel):
    batch_id: str
    file_name: str
    status: str
    duplicate_file_warning: bool
    rows_total: int
    rows_valid: int
    rows_error: int
    rows_unmapped: int
    unmapped_product_names: list[str]
    latest_sale_time: datetime | None
    errors: list[CsvPreviewRowError]
    sample_valid_rows: list[CsvPreviewValidRow]


class CsvCommitResponse(BaseModel):
    batch_id: str
    status: str
    orders_upserted: int
    items_recorded: int
    unmapped_count: int
    latest_sale_time: datetime | None


class ProductMappingUpsertRequest(BaseModel):
    external_product_name: str = Field(..., min_length=1, max_length=120)
    menu_item_id: str = Field(..., min_length=1)


class ProductMappingResponse(BaseModel):
    id: str
    store_id: str
    external_product_name: str
    menu_item_id: str
    menu_name: str
    retroactive_updated_items: int = 0


AdjustmentReasonType = Literal["WASTE", "SPOILAGE", "CORRECTION", "OTHER"]
StockAlertStatusType = Literal["OK", "LOW_STOCK", "NEGATIVE_WARNING"]


class InventoryReceiptCreate(BaseModel):
    ingredient_id: str = Field(..., min_length=1)
    purchase_quantity: Decimal = Field(..., gt=0)
    total_cost: Decimal = Field(..., ge=0)
    supplier_name: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=200)


class InventoryReceiptResponse(BaseModel):
    id: str
    store_id: str
    ingredient_id: str
    ingredient_name: str
    purchase_quantity: Decimal
    purchase_unit: str
    base_quantity: Decimal
    base_unit: str
    total_cost: Decimal
    unit_cost_per_purchase: Decimal
    unit_cost_per_base: Decimal
    supplier_name: str | None
    notes: str | None
    received_at: datetime


class InventoryCountCreate(BaseModel):
    ingredient_id: str = Field(..., min_length=1)
    actual_quantity: Decimal = Field(..., ge=0)
    notes: str | None = Field(default=None, max_length=200)


class InventoryCountResponse(BaseModel):
    id: str
    store_id: str
    ingredient_id: str
    ingredient_name: str
    actual_quantity: Decimal
    base_unit: str
    notes: str | None
    counted_at: datetime


class InventoryAdjustmentCreate(BaseModel):
    ingredient_id: str = Field(..., min_length=1)
    quantity_delta: Decimal = Field(...)
    reason: AdjustmentReasonType = Field(default="WASTE")
    notes: str | None = Field(default=None, max_length=200)


class InventoryAdjustmentResponse(BaseModel):
    id: str
    store_id: str
    ingredient_id: str
    ingredient_name: str
    quantity_delta: Decimal
    base_unit: str
    reason: AdjustmentReasonType
    notes: str | None
    occurred_at: datetime


class IngredientInventoryItem(BaseModel):
    ingredient_id: str
    ingredient_name: str
    is_active: bool
    base_unit: str
    purchase_unit: str
    conversion_factor: Decimal
    safety_stock: Decimal | None
    latest_unit_cost_per_purchase: Decimal | None
    latest_unit_cost_per_base: Decimal | None
    cost_basis_label: str = "최근 입고 단가 기준 (PROVISIONAL P-12)"
    last_actual_quantity: Decimal | None
    last_counted_at: datetime | None
    receipts_since_count_base: Decimal
    theoretical_consumption_base: Decimal
    adjustments_since_count_base: Decimal
    estimated_quantity: Decimal
    stock_status: StockAlertStatusType


class SalesHourlyBucket(BaseModel):
    hour: int = Field(..., ge=0, le=23)
    quantity: int
    sales_amount: Decimal


class MenuSalesRankItem(BaseModel):
    menu_item_id: str | None
    menu_name: str
    mapping_status: Literal["MAPPED", "UNMAPPED"]
    quantity: int
    sales_amount: Decimal


class SalesAnalyticsResponse(BaseModel):
    store_id: str
    total_completed_orders: int
    total_quantity: int
    total_net_sales: Decimal
    known_hour_quantity: int
    unknown_hour_quantity: int
    hourly_buckets: list[SalesHourlyBucket]
    menu_rankings: list[MenuSalesRankItem]


MenuCostStatusType = Literal["COMPLETE", "NO_RECIPE", "INCOMPLETE_COST"]


class CostSimulationRequest(BaseModel):
    global_change_percent: Decimal = Field(default=Decimal(0))
    ingredient_change_percents: dict[str, Decimal] = Field(default_factory=dict)


class MenuCostIngredientBreakdown(BaseModel):
    ingredient_id: str
    ingredient_name: str
    quantity: Decimal
    base_unit: str
    base_unit_cost: Decimal | None
    simulated_unit_cost: Decimal | None
    base_line_cost: Decimal | None
    simulated_line_cost: Decimal | None


class MenuCostSimulationItem(BaseModel):
    menu_item_id: str
    menu_name: str
    category: str | None
    selling_price: Decimal | None
    cost_status: MenuCostStatusType
    missing_cost_ingredients: list[str]
    base_recipe_cost: Decimal
    simulated_recipe_cost: Decimal
    cost_delta: Decimal
    base_margin: Decimal | None
    simulated_margin: Decimal | None
    base_cost_ratio_percent: Decimal | None
    simulated_cost_ratio_percent: Decimal | None
    high_cost_warning: bool
    breakdown: list[MenuCostIngredientBreakdown]


class CostSimulationResponse(BaseModel):
    store_id: str
    cost_basis_label: str = "최근 입고 단가 기준 (PROVISIONAL P-12 · 비파괴 시뮬레이션)"
    global_change_percent: Decimal
    menus: list[MenuCostSimulationItem]


class SalesOrderItemResponse(BaseModel):
    id: str
    raw_product_name: str
    menu_item_id: str | None
    menu_name: str | None
    mapping_status: Literal["MAPPED", "UNMAPPED"]
    quantity: int
    unit_price: Decimal
    line_amount: Decimal


class SalesOrderResponse(BaseModel):
    id: str
    store_id: str
    external_order_id: str
    ordered_at: datetime | None
    time_basis: str
    order_status: Literal["COMPLETED", "CANCELLED"]
    total_quantity: int
    total_amount: Decimal
    source_mode: str
    items: list[SalesOrderItemResponse]


class SalesOrdersListResponse(BaseModel):
    store_id: str
    pos_mode: PosModeType
    can_manual_edit: bool
    mode_notice: str
    orders: list[SalesOrderResponse]


class SalesOrderItemUpdateInput(BaseModel):
    item_id: str = Field(..., min_length=1)
    quantity: int = Field(..., ge=1, le=1000)


class SalesOrderUpdateRequest(BaseModel):
    order_status: Literal["COMPLETED", "CANCELLED"] | None = None
    items: list[SalesOrderItemUpdateInput] | None = None


class SalesOrderCreateItemInput(BaseModel):
    menu_item_id: str = Field(..., min_length=1)
    quantity: int = Field(..., ge=1, le=1000)


class SalesOrderCreateRequest(BaseModel):
    external_order_id: str | None = Field(default=None, max_length=100)
    ordered_at: datetime | None = None
    items: list[SalesOrderCreateItemInput] = Field(..., min_length=1)





