import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_uuid() -> str:
    return str(uuid.uuid4())


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Seoul")
    business_days: Mapped[str | None] = mapped_column(String(64), nullable=True)
    opening_hours: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    menu_items: Mapped[list["MenuItem"]] = relationship("MenuItem", back_populates="store")
    ingredients: Mapped[list["Ingredient"]] = relationship("Ingredient", back_populates="store")
    tables: Mapped[list["StoreTable"]] = relationship("StoreTable", back_populates="store")
    visit_sessions: Mapped[list["VisitSession"]] = relationship("VisitSession", back_populates="store")


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # PROVISIONAL (P-02): 판매가격은 선택 입력, 0 이상, 정밀 Decimal(12, 2)로 저장
    selling_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    # PROVISIONAL (P-03): 카테고리는 초기 버전에서 자유 텍스트로 관리
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # PROVISIONAL (P-06): 물리 삭제 대신 비활성화(is_active=False)로 과거 판매/원가 근거 보존
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    store: Mapped["Store"] = relationship("Store", back_populates="menu_items")
    recipe: Mapped["Recipe | None"] = relationship("Recipe", back_populates="menu_item", uselist=False)


class Ingredient(Base):
    __tablename__ = "ingredients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # PROVISIONAL (P-10): base_unit은 레시피/재고 기준 단위(g, ml, ea), purchase_unit은 구매 단위(kg, L, pack 등)
    base_unit: Mapped[str] = mapped_column(String(16), nullable=False, default="g")
    purchase_unit: Mapped[str] = mapped_column(String(16), nullable=False, default="kg")
    # 1 purchase_unit 당 몇 base_unit 인지 (예: 1 kg = 1000 g -> 1000)
    conversion_factor: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal(1000)
    )
    safety_stock: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    store: Mapped["Store"] = relationship("Store", back_populates="ingredients")
    recipe_items: Mapped[list["RecipeItem"]] = relationship("RecipeItem", back_populates="ingredient")


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    menu_item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("menu_items.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # COMPLETE: 완성, PARTIAL: 일부 미입력(작성 중)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="COMPLETE")
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    menu_item: Mapped["MenuItem"] = relationship("MenuItem", back_populates="recipe")
    items: Mapped[list["RecipeItem"]] = relationship(
        "RecipeItem", back_populates="recipe", cascade="all, delete-orphan"
    )


class RecipeItem(Base):
    __tablename__ = "recipe_items"
    __table_args__ = (UniqueConstraint("recipe_id", "ingredient_id", name="uq_recipe_ingredient"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    recipe_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ingredient_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("ingredients.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit: Mapped[str] = mapped_column(String(16), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)

    recipe: Mapped["Recipe"] = relationship("Recipe", back_populates="items")
    ingredient: Mapped["Ingredient"] = relationship("Ingredient", back_populates="recipe_items")


class StoreTable(Base):
    __tablename__ = "store_tables"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    seats: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    grid_x: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    grid_y: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    store: Mapped["Store"] = relationship("Store", back_populates="tables")
    visit_sessions: Mapped[list["VisitSession"]] = relationship(
        "VisitSession", back_populates="table"
    )


class VisitSession(Base):
    __tablename__ = "visit_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    table_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("store_tables.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    party_size: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    # PROVISIONAL (P-11): 대표 연령대 선택값 (UNRECORDED 기본)
    age_band: Mapped[str] = mapped_column(String(32), nullable=False, default="UNRECORDED")
    # SEATED(착석중) -> PAID(결제완료, 아직 착석중) -> LEFT(퇴점·테이블 비우기 완료)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="SEATED", index=True)
    seated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)

    store: Mapped["Store"] = relationship("Store", back_populates="visit_sessions")
    table: Mapped["StoreTable"] = relationship("StoreTable", back_populates="visit_sessions")


class PosConnection(Base):
    __tablename__ = "pos_connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, unique=True, index=True
    )
    # TOSS_OPEN_API | TOSS_PLUGIN | CSV_UPLOAD
    mode: Mapped[str] = mapped_column(String(32), nullable=False, default="CSV_UPLOAD")
    # UNVERIFIED | READY_CSV
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="READY_CSV")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latest_data_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class PosProductMapping(Base):
    __tablename__ = "pos_product_mappings"
    __table_args__ = (
        UniqueConstraint("store_id", "external_product_name", name="uq_store_ext_product_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    external_product_name: Mapped[str] = mapped_column(String(120), nullable=False)
    menu_item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("menu_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    file_name: Mapped[str] = mapped_column(String(200), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # PREVIEWED | COMMITTED
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="PREVIEWED")
    duplicate_file_warning: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rows_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_valid: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_error: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_unmapped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    latest_sale_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    preview_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SalesOrder(Base):
    __tablename__ = "sales_orders"
    __table_args__ = (
        UniqueConstraint("store_id", "external_order_id", name="uq_store_ext_order_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    import_batch_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True
    )
    source_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="CSV_UPLOAD")
    external_order_id: Mapped[str] = mapped_column(String(100), nullable=False)
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # order_time | date_only | unknown
    time_basis: Mapped[str] = mapped_column(String(32), nullable=False, default="order_time")
    # COMPLETED | CANCELLED
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="COMPLETED")
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    items: Mapped[list["SalesOrderItem"]] = relationship(
        "SalesOrderItem", back_populates="order", cascade="all, delete-orphan"
    )


class SalesOrderItem(Base):
    __tablename__ = "sales_order_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    order_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    menu_item_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    raw_product_name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_price: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal(0)
    )
    # COMPLETED | CANCELLED
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="COMPLETED")
    # MAPPED | UNMAPPED
    mapping_status: Mapped[str] = mapped_column(String(24), nullable=False, default="UNMAPPED")
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    order: Mapped["SalesOrder"] = relationship("SalesOrder", back_populates="items")


class InventoryReceipt(Base):
    __tablename__ = "inventory_receipts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ingredient_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("ingredients.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    purchase_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    purchase_unit: Mapped[str] = mapped_column(String(24), nullable=False)
    base_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    base_unit: Mapped[str] = mapped_column(String(16), nullable=False)
    total_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    unit_cost_per_purchase: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    unit_cost_per_base: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    supplier_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class InventoryCount(Base):
    __tablename__ = "inventory_counts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ingredient_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("ingredients.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    actual_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    base_unit: Mapped[str] = mapped_column(String(16), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)
    counted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class InventoryAdjustment(Base):
    __tablename__ = "inventory_adjustments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ingredient_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("ingredients.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # 기본 단위 기준 증감량 (예: 폐기 시 음수 -200, 추가 보정 시 +100)
    quantity_delta: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    base_unit: Mapped[str] = mapped_column(String(16), nullable=False)
    # WASTE | SPOILAGE | CORRECTION | OTHER
    reason: Mapped[str] = mapped_column(String(32), nullable=False, default="WASTE")
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    store_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    actor: Mapped[str] = mapped_column(String(64), nullable=False, default="local_operator")
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    change_summary: Mapped[str] = mapped_column(Text, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
