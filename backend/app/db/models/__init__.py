import secrets
import time
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_uuid() -> uuid.UUID:
    """UUID v7 (RFC 9562 5.7). 앞 48비트가 ms 시각이라 생성 순서대로 인덱스 끝에 붙는다.

    PostgreSQL 17과 Python 3.12에는 v7 생성 함수가 없어 앱에서 만든다 (근거: ADR-016).
    같은 ms 안의 순서는 보장하지 않는다.
    """
    value = (time.time_ns() // 1_000_000) << 80 | secrets.randbits(80)
    value = value & ~(0xF << 76) | (0x7 << 76)  # version 7
    value = value & ~(0x3 << 62) | (0x2 << 62)  # variant 10
    return uuid.UUID(int=value)


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Seoul")
    business_days: Mapped[str | None] = mapped_column(String(64), nullable=True)
    opening_hours: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 도면 고정물(입구·카운터·칸막이·주방) JSON 목록. 테이블과 같은 24×28 좌표계 (U-31)
    floor_fixtures: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    menu_items: Mapped[list["MenuItem"]] = relationship("MenuItem", back_populates="store")
    ingredients: Mapped[list["Ingredient"]] = relationship("Ingredient", back_populates="store")
    tables: Mapped[list["StoreTable"]] = relationship("StoreTable", back_populates="store")
    visit_sessions: Mapped[list["VisitSession"]] = relationship(
        "VisitSession", back_populates="store"
    )


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # PROVISIONAL (P-02): 판매가격은 선택 입력, 0 이상, 정밀 Decimal(12, 2)로 저장
    selling_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    # PROVISIONAL (P-03): 카테고리는 초기 버전에서 자유 텍스트로 관리
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # PROVISIONAL (P-06): 물리 삭제 대신 비활성화(is_active=False)로 과거 판매/원가 근거 보존
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    store: Mapped["Store"] = relationship("Store", back_populates="menu_items")
    recipe: Mapped["Recipe | None"] = relationship(
        "Recipe", back_populates="menu_item", uselist=False
    )


class Ingredient(Base):
    __tablename__ = "ingredients"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    store: Mapped["Store"] = relationship("Store", back_populates="ingredients")
    recipe_items: Mapped[list["RecipeItem"]] = relationship(
        "RecipeItem", back_populates="ingredient"
    )


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("menu_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # COMPLETE: 완성, PARTIAL: 일부 미입력(작성 중)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="COMPLETE")
    effective_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    menu_item: Mapped["MenuItem"] = relationship("MenuItem", back_populates="recipe")
    items: Mapped[list["RecipeItem"]] = relationship(
        "RecipeItem", back_populates="recipe", cascade="all, delete-orphan"
    )

    # DB(0002)는 unique 제약 + 일반 인덱스다. unique=True, index=True는 unique 인덱스라 alembic check가 어긋난다
    __table_args__ = (UniqueConstraint("menu_item_id", name="recipes_menu_item_id_key"),)


class RecipeItem(Base):
    __tablename__ = "recipe_items"
    __table_args__ = (UniqueConstraint("recipe_id", "ingredient_id", name="uq_recipe_ingredient"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    recipe_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # RLS 정책이 부모 조인 없이 걸리도록 매장 ID를 직접 가진다 (ADR-013)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ingredient_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("ingredients.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit: Mapped[str] = mapped_column(String(16), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)

    recipe: Mapped["Recipe"] = relationship("Recipe", back_populates="items")
    ingredient: Mapped["Ingredient"] = relationship("Ingredient", back_populates="recipe_items")


class StoreTable(Base):
    __tablename__ = "store_tables"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    seats: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    grid_x: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    grid_y: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # H(가로로 긴 테이블, 의자 위·아래) | V(세로로 긴 테이블, 의자 좌·우)
    orientation: Mapped[str] = mapped_column(String(1), nullable=False, default="H")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    store: Mapped["Store"] = relationship("Store", back_populates="tables")
    visit_sessions: Mapped[list["VisitSession"]] = relationship(
        "VisitSession", back_populates="table"
    )


class VisitSession(Base):
    __tablename__ = "visit_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    table_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("store_tables.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    party_size: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    # PROVISIONAL (P-11): 대표 연령대 선택값 (UNRECORDED 기본)
    age_band: Mapped[str] = mapped_column(String(32), nullable=False, default="UNRECORDED")
    # SEATED(착석중) -> PAID(결제완료, 아직 착석중) -> LEFT(퇴점·테이블 비우기 완료)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="SEATED", index=True)
    seated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # U-18: GUEST_QR | STAFF | CSV_BACKFILL (손님 > 직원, CSV_BACKFILL은 화면 표시에 안 씀)
    party_size_source: Mapped[str] = mapped_column(String(20), nullable=False, default="STAFF")
    # 세션을 연 신호: GUEST_QR | STAFF
    opened_by: Mapped[str] = mapped_column(String(20), nullable=False, default="STAFF")
    # U-19: NEXT_PARTY | CLEARED | TIMEOUT | END_OF_DAY (LEFT일 때만)
    closed_reason: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # U-31 세션 단위 선택값 (PROVISIONAL 선택지). *_source: GUEST | STAFF, 손님 값은 직원이 덮어쓰지 않음
    purpose: Mapped[str | None] = mapped_column(String(20), nullable=True)
    relationship_type: Mapped[str | None] = mapped_column("relationship", String(20), nullable=True)
    context_source: Mapped[str | None] = mapped_column(String(10), nullable=True)

    store: Mapped["Store"] = relationship("Store", back_populates="visit_sessions")
    table: Mapped["StoreTable"] = relationship("StoreTable", back_populates="visit_sessions")
    slots: Mapped[list["SessionSlot"]] = relationship(
        "SessionSlot", back_populates="session", order_by="SessionSlot.slot_no"
    )

    __table_args__ = (
        # 테이블당 열린 세션은 1개 (동시에 열면 먼저 저장된 쪽만 성공)
        Index(
            "uq_visit_sessions_open_table",
            "table_id",
            unique=True,
            postgresql_where=text("status IN ('SEATED', 'PAID')"),
            sqlite_where=text("status IN ('SEATED', 'PAID')"),
        ),
    )


class TableQrToken(Base):
    """테이블 QR에 들어가는 추측 불가 토큰. 테이블당 활성 토큰 1개, 회전하면 교체."""

    __tablename__ = "table_qr_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    table_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("store_tables.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    rotated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class GuestDevice(Base):
    """익명 손님 기기 (전역, 개인정보 없음). 쿠키 토큰 원문은 저장하지 않고 해시만 둔다."""

    __tablename__ = "guest_devices"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class SessionSlot(Base):
    """방문 세션의 1명 자리. 캐릭터는 다음 단계에서 붙는다."""

    __tablename__ = "session_slots"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("visit_sessions.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    slot_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # EMPTY | SILHOUETTE | EDITING | CUSTOM
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="SILHOUETTE")
    created_by_device_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("guest_devices.id", ondelete="RESTRICT"), nullable=True
    )
    claimed_by_device_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("guest_devices.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    display_opt_out: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # U-31 사람별 선택값. profile_source: GUEST | STAFF (손님 값 우선)
    gender: Mapped[str] = mapped_column(String(12), nullable=False, default="UNRECORDED")
    age_band: Mapped[str] = mapped_column(String(32), nullable=False, default="UNRECORDED")
    profile_source: Mapped[str | None] = mapped_column(String(10), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    session: Mapped["VisitSession"] = relationship("VisitSession", back_populates="slots")

    __table_args__ = (
        UniqueConstraint("session_id", "slot_no", name="uq_session_slots_session_slot"),
    )


class PosConnection(Base):
    __tablename__ = "pos_connections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # TOSS_OPEN_API | TOSS_PLUGIN | CSV_UPLOAD
    mode: Mapped[str] = mapped_column(String(32), nullable=False, default="CSV_UPLOAD")
    # UNVERIFIED | READY_CSV
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="READY_CSV")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latest_data_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    # DB(0004)와 같은 형태: unique 제약 + 일반 인덱스
    __table_args__ = (UniqueConstraint("store_id", name="pos_connections_store_id_key"),)


class PosProductMapping(Base):
    __tablename__ = "pos_product_mappings"
    __table_args__ = (
        UniqueConstraint("store_id", "external_product_name", name="uq_store_ext_product_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    external_product_name: Mapped[str] = mapped_column(String(120), nullable=False)
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("menu_items.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
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
    latest_sale_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    preview_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SalesOrder(Base):
    __tablename__ = "sales_orders"
    __table_args__ = (
        UniqueConstraint("store_id", "external_order_id", name="uq_store_ext_order_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    import_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True
    )
    source_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="CSV_UPLOAD")
    external_order_id: Mapped[str] = mapped_column(String(100), nullable=False)
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # order_time | date_only | unknown
    time_basis: Mapped[str] = mapped_column(String(32), nullable=False, default="order_time")
    # COMPLETED | CANCELLED
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="COMPLETED")
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    items: Mapped[list["SalesOrderItem"]] = relationship(
        "SalesOrderItem", back_populates="order", cascade="all, delete-orphan"
    )


class SalesOrderItem(Base):
    __tablename__ = "sales_order_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    order_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    menu_item_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    raw_product_name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal(0))
    # COMPLETED | CANCELLED
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="COMPLETED")
    # MAPPED | UNMAPPED
    mapping_status: Mapped[str] = mapped_column(String(24), nullable=False, default="UNMAPPED")
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    order: Mapped["SalesOrder"] = relationship("SalesOrder", back_populates="items")


class InventoryReceipt(Base):
    __tablename__ = "inventory_receipts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ingredient_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("ingredients.id", ondelete="RESTRICT"), nullable=False, index=True
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

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ingredient_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("ingredients.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    actual_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    base_unit: Mapped[str] = mapped_column(String(16), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)
    counted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class InventoryAdjustment(Base):
    __tablename__ = "inventory_adjustments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ingredient_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("ingredients.id", ondelete="RESTRICT"), nullable=False, index=True
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

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    actor: Mapped[str] = mapped_column(String(64), nullable=False, default="local_operator")
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    change_summary: Mapped[str] = mapped_column(Text, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class Holiday(Base):
    """전역 공휴일 달력 (매장 데이터가 아니라 RLS 없음, U-28)."""

    __tablename__ = "holidays"

    holiday_date: Mapped[date] = mapped_column(Date, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    # KASI(천문연 특일정보) | MANUAL
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="MANUAL")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
