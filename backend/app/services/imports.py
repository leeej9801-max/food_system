import csv
import hashlib
import io
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AppError
from app.db.models import (
    ImportBatch,
    MenuItem,
    PosConnection,
    PosProductMapping,
    SalesOrder,
    SalesOrderItem,
    utcnow,
)
from app.schemas import (
    CsvCommitResponse,
    CsvPreviewRequest,
    CsvPreviewResponse,
    CsvPreviewRowError,
    CsvPreviewValidRow,
    IntegrationStatusResponse,
    PosModeType,
    PosModeUpdateRequest,
    ProductMappingResponse,
    ProductMappingUpsertRequest,
    SalesOrderCreateRequest,
    SalesOrderItemResponse,
    SalesOrderResponse,
    SalesOrdersListResponse,
    SalesOrderUpdateRequest,
)
from app.services.menus import get_store_or_404, record_audit

SAMPLE_WESTERN_BISTRO_CSV = """order_id,ordered_at,menu_name,quantity,unit_price,status
ORD-20261025-001,2026-10-25 12:15:00,까르보나라,2,16000,COMPLETED
ORD-20261025-001,2026-10-25 12:15:00,알리오올리오,1,14000,COMPLETED
ORD-20261025-002,2026-10-25 13:20:00,부채살 스테이크,1,29000,COMPLETED
ORD-20261025-003,2026-10-25 18:40:00,하우스 와인(글라스),2,9000,COMPLETED
ORD-20261025-004,2026-10-25 19:05:00,까르보나라,1,16000,CANCELLED
"""


def get_sample_sales_csv() -> str:
    return SAMPLE_WESTERN_BISTRO_CSV


def _get_or_create_pos_connection(db: Session, *, store_id: str) -> PosConnection:
    stmt = select(PosConnection).where(PosConnection.store_id == store_id)
    conn = db.scalars(stmt).first()
    if conn is None:
        conn = PosConnection(
            store_id=store_id,
            mode="CSV_UPLOAD",
            status="READY_CSV",
        )
        db.add(conn)
        db.flush()
    return conn


def _parse_datetime(
    raw: str,
) -> tuple[datetime | None, Literal["order_time", "date_only", "unknown"]]:
    text = raw.strip()
    if not text:
        return None, "unknown"
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
    ):
        try:
            dt = datetime.strptime(text, fmt).replace(tzinfo=UTC)
            return dt, "order_time"
        except ValueError:
            continue
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            dt = datetime.strptime(text, fmt).replace(tzinfo=UTC)
            return dt, "date_only"
        except ValueError:
            continue
    raise ValueError(f"날짜/시각 형식을 해석할 수 없습니다: '{text}'")


def _normalize_status(raw: str) -> Literal["COMPLETED", "CANCELLED"]:
    val = raw.strip().upper()
    if val in ("CANCELLED", "CANCELED", "REFUND", "REFUNDED", "취소", "환불"):
        return "CANCELLED"
    return "COMPLETED"


def _build_menu_lookup(db: Session, *, store_id: str) -> dict[str, str]:
    """공백 제거 및 대소문자 무시(casefold) 기준으로 메뉴 마스터 및 외부 상품명 매핑 룩업 테이블 생성."""
    lookup: dict[str, str] = {}
    menus = list(
        db.scalars(select(MenuItem).where(MenuItem.store_id == store_id)).all()
    )
    for m in menus:
        if m.is_active:
            lookup[m.name.strip().casefold()] = m.id
    mappings = list(
        db.scalars(
            select(PosProductMapping).where(PosProductMapping.store_id == store_id)
        ).all()
    )
    for mp in mappings:
        lookup[mp.external_product_name.strip().casefold()] = mp.menu_item_id
    return lookup


def get_integration_status(db: Session, *, store_id: str) -> IntegrationStatusResponse:
    get_store_or_404(db, store_id)
    conn = _get_or_create_pos_connection(db, store_id=store_id)
    db.commit()

    orders = list(
        db.scalars(
            select(SalesOrder)
            .options(selectinload(SalesOrder.items))
            .where(SalesOrder.store_id == store_id)
            .execution_options(populate_existing=True)
        ).all()
    )

    completed_orders = [o for o in orders if o.status == "COMPLETED"]
    net_sales = Decimal("0.00")
    net_qty = 0
    unmapped_set: set[str] = set()

    for order in orders:
        for item in order.items:
            if item.mapping_status == "UNMAPPED":
                unmapped_set.add(item.raw_product_name)
            if order.status == "COMPLETED" and item.status == "COMPLETED":
                net_sales += Decimal(str(item.unit_price)) * item.quantity
                net_qty += item.quantity

    mode_val: PosModeType = (
        "TOSS_OPEN_API"
        if conn.mode == "TOSS_OPEN_API"
        else "TOSS_PLUGIN"
        if conn.mode == "TOSS_PLUGIN"
        else "CSV_UPLOAD"
    )
    status_val: Literal["UNVERIFIED", "READY_CSV"] = (
        "READY_CSV" if mode_val == "CSV_UPLOAD" else "UNVERIFIED"
    )

    return IntegrationStatusResponse(
        store_id=store_id,
        mode=mode_val,
        connection_status=status_val,
        is_realtime=False,
        last_synced_at=conn.last_synced_at,
        latest_data_time=conn.latest_data_time,
        total_orders_count=len(completed_orders),
        net_sales_amount=net_sales.quantize(Decimal("0.01")),
        net_items_quantity=net_qty,
        unmapped_products=sorted(unmapped_set),
    )


def update_pos_mode(
    db: Session, *, store_id: str, payload: PosModeUpdateRequest
) -> IntegrationStatusResponse:
    get_store_or_404(db, store_id)
    conn = _get_or_create_pos_connection(db, store_id=store_id)
    before_mode = conn.mode
    conn.mode = payload.mode
    conn.status = "READY_CSV" if payload.mode == "CSV_UPLOAD" else "UNVERIFIED"
    conn.updated_at = utcnow()
    record_audit(
        db,
        store_id=store_id,
        entity_type="pos_connection",
        entity_id=conn.id,
        action="mode_updated",
        summary={
            "before": {"mode": before_mode},
            "after": {
                "mode": conn.mode,
                "connection_status": conn.status,
            },
        },
    )
    db.commit()
    return get_integration_status(db, store_id=store_id)


def preview_sales_csv(
    db: Session, *, store_id: str, payload: CsvPreviewRequest
) -> CsvPreviewResponse:
    get_store_or_404(db, store_id)
    # Excel UTF-8 BOM(\ufeff) 제거 후 해시 및 파싱 수행
    normalized_csv = payload.csv_text.lstrip("\ufeff").strip()
    file_hash = hashlib.sha256(normalized_csv.encode("utf-8")).hexdigest()

    existing_committed = db.scalars(
        select(ImportBatch).where(
            ImportBatch.store_id == store_id,
            ImportBatch.file_hash == file_hash,
            ImportBatch.status == "COMMITTED",
        )
    ).first()
    duplicate_warning = existing_committed is not None

    reader = csv.DictReader(io.StringIO(normalized_csv))
    if not reader.fieldnames:
        raise AppError(
            status_code=422,
            code="CSV_EMPTY_HEADER",
            message="CSV 헤더를 읽할 수 없습니다.",
        )

    mapping = payload.mapping
    menu_lookup = _build_menu_lookup(db, store_id=store_id)

    valid_rows: list[CsvPreviewValidRow] = []
    errors: list[CsvPreviewRowError] = []
    unmapped_names: set[str] = set()
    latest_time: datetime | None = None
    rows_total = 0

    for idx, raw_row in enumerate(reader, start=2):
        rows_total += 1
        clean_row = {
            str(k or "").lstrip("\ufeff").strip(): str(v or "").strip()
            for k, v in raw_row.items()
        }

        order_id = clean_row.get(mapping.order_id_col, "").strip()
        product_name = clean_row.get(mapping.product_name_col, "").strip()
        raw_qty = clean_row.get(mapping.quantity_col, "").strip()
        raw_price = clean_row.get(mapping.unit_price_col, "0").strip() or "0"
        raw_dt = clean_row.get(mapping.ordered_at_col, "").strip()
        raw_status = clean_row.get(mapping.status_col, "COMPLETED").strip()

        if not order_id:
            errors.append(
                CsvPreviewRowError(
                    row_number=idx,
                    reason=f"주문번호({mapping.order_id_col})가 비어 있습니다.",
                    raw_row=clean_row,
                )
            )
            continue

        if not product_name:
            errors.append(
                CsvPreviewRowError(
                    row_number=idx,
                    reason=f"상품명({mapping.product_name_col})이 비어 있습니다.",
                    raw_row=clean_row,
                )
            )
            continue

        try:
            qty = int(raw_qty)
            if qty <= 0:
                raise ValueError("수량은 1 이상이어야 합니다.")
        except ValueError:
            errors.append(
                CsvPreviewRowError(
                    row_number=idx,
                    reason=f"수량({raw_qty})은 1 이상의 정수여야 합니다.",
                    raw_row=clean_row,
                )
            )
            continue

        try:
            unit_price = Decimal(raw_price.replace(",", ""))
            if unit_price < 0:
                raise ValueError("단가는 0 이상이어야 합니다.")
        except (InvalidOperation, ValueError):
            errors.append(
                CsvPreviewRowError(
                    row_number=idx,
                    reason=f"단가({raw_price})가 올바른 숫자가 아닙니다.",
                    raw_row=clean_row,
                )
            )
            continue

        try:
            ordered_at, time_basis = _parse_datetime(raw_dt)
        except ValueError as exc:
            errors.append(
                CsvPreviewRowError(
                    row_number=idx,
                    reason=str(exc),
                    raw_row=clean_row,
                )
            )
            continue

        status_val = _normalize_status(raw_status)
        menu_item_id = menu_lookup.get(product_name.casefold())
        mapping_status: Literal["MAPPED", "UNMAPPED"] = (
            "MAPPED" if menu_item_id else "UNMAPPED"
        )
        if mapping_status == "UNMAPPED":
            unmapped_names.add(product_name)

        if ordered_at is not None and (latest_time is None or ordered_at > latest_time):
            latest_time = ordered_at

        valid_rows.append(
            CsvPreviewValidRow(
                row_number=idx,
                external_order_id=order_id,
                ordered_at=ordered_at,
                time_basis=time_basis,
                raw_product_name=product_name,
                menu_item_id=menu_item_id,
                mapping_status=mapping_status,
                quantity=qty,
                unit_price=unit_price.quantize(Decimal("0.01")),
                status=status_val,
            )
        )

    batch = ImportBatch(
        store_id=store_id,
        file_name=payload.file_name,
        file_hash=file_hash,
        status="PREVIEWED",
        duplicate_file_warning=duplicate_warning,
        rows_total=rows_total,
        rows_valid=len(valid_rows),
        rows_error=len(errors),
        rows_unmapped=sum(1 for r in valid_rows if r.mapping_status == "UNMAPPED"),
        latest_sale_time=latest_time,
        preview_json=json.dumps(
            {
                "valid_rows": [r.model_dump(mode="json") for r in valid_rows],
                "errors": [e.model_dump(mode="json") for e in errors],
                "duplicate_file_warning": duplicate_warning,
            },
            ensure_ascii=False,
        ),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    return CsvPreviewResponse(
        batch_id=batch.id,
        file_name=batch.file_name,
        status=batch.status,
        duplicate_file_warning=duplicate_warning,
        rows_total=batch.rows_total,
        rows_valid=batch.rows_valid,
        rows_error=batch.rows_error,
        rows_unmapped=batch.rows_unmapped,
        unmapped_product_names=sorted(unmapped_names),
        latest_sale_time=batch.latest_sale_time,
        errors=errors,
        sample_valid_rows=valid_rows[:50],
    )


def commit_sales_csv(
    db: Session, *, store_id: str, batch_id: str
) -> CsvCommitResponse:
    get_store_or_404(db, store_id)
    batch = db.scalars(
        select(ImportBatch).where(
            ImportBatch.id == batch_id, ImportBatch.store_id == store_id
        )
    ).first()
    if batch is None:
        raise AppError(
            status_code=404,
            code="IMPORT_BATCH_NOT_FOUND",
            message="CSV 미리보기 배치를 찾을 수 없습니다.",
        )

    parsed_preview = json.loads(batch.preview_json or "{}")
    valid_rows_raw = parsed_preview.get("valid_rows", [])
    if not valid_rows_raw:
        raise AppError(
            status_code=422,
            code="IMPORT_BATCH_NO_VALID_ROWS",
            message="반영할 수 있는 유효한 판매 행이 없습니다.",
        )

    menu_lookup = _build_menu_lookup(db, store_id=store_id)

    grouped_orders: dict[str, list[dict]] = {}
    for row in valid_rows_raw:
        ext_id = row["external_order_id"]
        grouped_orders.setdefault(ext_id, []).append(row)

    # 단일 배치 조회로 기존 주문 N+1 쿼리 제거
    ext_ids = list(grouped_orders.keys())
    existing_orders_by_ext: dict[str, SalesOrder] = {}
    if ext_ids:
        found_orders = list(
            db.scalars(
                select(SalesOrder)
                .options(selectinload(SalesOrder.items))
                .where(
                    SalesOrder.store_id == store_id,
                    SalesOrder.external_order_id.in_(ext_ids),
                )
            ).all()
        )
        existing_orders_by_ext = {o.external_order_id: o for o in found_orders}

    orders_upserted = 0
    items_recorded = 0
    unmapped_count = 0
    latest_time: datetime | None = batch.latest_sale_time
    now_ts = utcnow()

    for ext_id, rows in grouped_orders.items():
        first = rows[0]
        ordered_at_str = first.get("ordered_at")
        ordered_at = (
            datetime.fromisoformat(ordered_at_str) if ordered_at_str else None
        )
        time_basis = first.get("time_basis", "order_time")

        all_cancelled = all(r.get("status") == "CANCELLED" for r in rows)
        order_status = "CANCELLED" if all_cancelled else "COMPLETED"

        existing_order = existing_orders_by_ext.get(ext_id)

        if existing_order is None:
            order = SalesOrder(
                store_id=store_id,
                import_batch_id=batch.id,
                source_mode="CSV_UPLOAD",
                external_order_id=ext_id,
                ordered_at=ordered_at,
                time_basis=time_basis,
                status=order_status,
                received_at=now_ts,
            )
            db.add(order)
            db.flush()
        else:
            order = existing_order
            order.import_batch_id = batch.id
            order.ordered_at = ordered_at
            order.time_basis = time_basis
            order.status = order_status
            order.received_at = now_ts
            for old_item in list(order.items):
                db.delete(old_item)
            db.flush()

        orders_upserted += 1

        for r in rows:
            raw_name = r["raw_product_name"].strip()
            menu_id = menu_lookup.get(raw_name.casefold())
            map_status = "MAPPED" if menu_id else "UNMAPPED"
            if map_status == "UNMAPPED":
                unmapped_count += 1
            qty = int(r["quantity"])
            u_price = Decimal(str(r["unit_price"])).quantize(Decimal("0.01"))
            item_status = r.get("status", "COMPLETED")
            r_ord_str = r.get("ordered_at")
            r_ord_dt = datetime.fromisoformat(r_ord_str) if r_ord_str else ordered_at

            item = SalesOrderItem(
                order_id=order.id,
                store_id=store_id,
                menu_item_id=menu_id,
                raw_product_name=raw_name,
                mapping_status=map_status,
                quantity=qty,
                unit_price=u_price,
                status=item_status,
                ordered_at=r_ord_dt,
            )
            db.add(item)
            items_recorded += 1

    batch.status = "COMMITTED"
    batch.rows_unmapped = unmapped_count
    batch.committed_at = now_ts

    conn = _get_or_create_pos_connection(db, store_id=store_id)
    conn.last_synced_at = now_ts
    if latest_time is not None and (
        conn.latest_data_time is None or latest_time > conn.latest_data_time
    ):
        conn.latest_data_time = latest_time
    conn.updated_at = now_ts

    record_audit(
        db,
        store_id=store_id,
        entity_type="import_batch",
        entity_id=batch.id,
        action="committed",
        summary={
            "file_name": batch.file_name,
            "orders_upserted": orders_upserted,
            "items_recorded": items_recorded,
            "unmapped_count": unmapped_count,
        },
    )
    db.commit()

    return CsvCommitResponse(
        batch_id=batch.id,
        status=batch.status,
        orders_upserted=orders_upserted,
        items_recorded=items_recorded,
        unmapped_count=unmapped_count,
        latest_sale_time=batch.latest_sale_time,
    )


def upsert_product_mapping(
    db: Session, *, store_id: str, payload: ProductMappingUpsertRequest
) -> ProductMappingResponse:
    get_store_or_404(db, store_id)
    ext_name = payload.external_product_name.strip()
    ext_norm = ext_name.casefold()
    menu = db.scalars(
        select(MenuItem).where(
            MenuItem.id == payload.menu_item_id, MenuItem.store_id == store_id
        )
    ).first()
    if menu is None:
        raise AppError(
            status_code=404,
            code="MENU_NOT_FOUND",
            message="연결할 메뉴를 찾을 수 없습니다.",
        )

    existing_mappings = list(
        db.scalars(
            select(PosProductMapping).where(PosProductMapping.store_id == store_id)
        ).all()
    )
    mapping = next(
        (
            m
            for m in existing_mappings
            if m.external_product_name.strip().casefold() == ext_norm
        ),
        None,
    )

    if mapping is None:
        mapping = PosProductMapping(
            store_id=store_id,
            external_product_name=ext_name,
            menu_item_id=menu.id,
        )
        db.add(mapping)
        db.flush()
    else:
        mapping.external_product_name = ext_name
        mapping.menu_item_id = menu.id

    items = list(
        db.scalars(
            select(SalesOrderItem).where(SalesOrderItem.store_id == store_id)
        ).all()
    )
    updated_count = 0
    for item in items:
        if item.raw_product_name.strip().casefold() == ext_norm:
            item.menu_item_id = menu.id
            item.mapping_status = "MAPPED"
            updated_count += 1

    record_audit(
        db,
        store_id=store_id,
        entity_type="pos_product_mapping",
        entity_id=mapping.id,
        action="upserted",
        summary={
            "external_product_name": ext_name,
            "menu_item_id": menu.id,
            "menu_name": menu.name,
            "retroactive_updated_items": updated_count,
        },
    )
    db.commit()
    db.refresh(mapping)

    return ProductMappingResponse(
        id=mapping.id,
        store_id=store_id,
        external_product_name=mapping.external_product_name,
        menu_item_id=menu.id,
        menu_name=menu.name,
        retroactive_updated_items=updated_count,
    )


def list_product_mappings(
    db: Session, *, store_id: str
) -> list[ProductMappingResponse]:
    get_store_or_404(db, store_id)
    mappings = list(
        db.scalars(
            select(PosProductMapping)
            .where(PosProductMapping.store_id == store_id)
            .order_by(PosProductMapping.external_product_name.asc())
        ).all()
    )
    menus_by_id = {
        m.id: m.name
        for m in db.scalars(
            select(MenuItem).where(MenuItem.store_id == store_id)
        ).all()
    }
    return [
        ProductMappingResponse(
            id=m.id,
            store_id=m.store_id,
            external_product_name=m.external_product_name,
            menu_item_id=m.menu_item_id,
            menu_name=menus_by_id.get(m.menu_item_id, ""),
            retroactive_updated_items=0,
        )
        for m in mappings
    ]


def _serialize_sales_order(
    order: SalesOrder, menus_by_id: dict[str, MenuItem]
) -> SalesOrderResponse:
    item_responses: list[SalesOrderItemResponse] = []
    total_qty = 0
    total_amt = Decimal(0)

    for it in order.items:
        line_amt = (it.unit_price * Decimal(it.quantity)).quantize(Decimal("0.01"))
        total_qty += it.quantity
        total_amt += line_amt
        menu_obj = menus_by_id.get(it.menu_item_id) if it.menu_item_id else None
        item_responses.append(
            SalesOrderItemResponse(
                id=it.id,
                raw_product_name=it.raw_product_name,
                menu_item_id=it.menu_item_id,
                menu_name=menu_obj.name if menu_obj else None,
                mapping_status="MAPPED" if it.mapping_status == "MAPPED" else "UNMAPPED",
                quantity=it.quantity,
                unit_price=it.unit_price.quantize(Decimal("0.01")),
                line_amount=line_amt,
            )
        )

    order_status: Literal["COMPLETED", "CANCELLED"] = (
        "CANCELLED" if order.status == "CANCELLED" else "COMPLETED"
    )
    return SalesOrderResponse(
        id=order.id,
        store_id=order.store_id,
        external_order_id=order.external_order_id,
        ordered_at=order.ordered_at,
        time_basis=order.time_basis,
        order_status=order_status,
        total_quantity=total_qty,
        total_amount=total_amt.quantize(Decimal("0.01")),
        source_mode=order.source_mode,
        items=item_responses,
    )


def list_sales_orders(db: Session, *, store_id: str) -> SalesOrdersListResponse:
    get_store_or_404(db, store_id)
    conn = _get_or_create_pos_connection(db, store_id=store_id)
    pos_mode: PosModeType = conn.mode  # type: ignore[assignment]
    can_manual_edit = pos_mode == "CSV_UPLOAD"
    mode_notice = (
        "CSV/수동 수집 모드: 현장에서 주문 수량 변경·환불(취소) 전환·수동 주문 추가 시 재고 및 매출 파이프라인에 즉시 반영됩니다."
        if can_manual_edit
        else "POS 연동 모드(A/B): 주문 변경 및 환불은 POS 단말기 이벤트에서 자동 동기화되므로 수동 수정이 잠겨 있습니다."
    )

    orders = list(
        db.scalars(
            select(SalesOrder)
            .options(selectinload(SalesOrder.items))
            .where(SalesOrder.store_id == store_id)
            .order_by(SalesOrder.received_at.desc(), SalesOrder.external_order_id.desc())
        ).all()
    )
    menus_by_id = {
        m.id: m
        for m in db.scalars(
            select(MenuItem).where(MenuItem.store_id == store_id)
        ).all()
    }

    return SalesOrdersListResponse(
        store_id=store_id,
        pos_mode=pos_mode,
        can_manual_edit=can_manual_edit,
        mode_notice=mode_notice,
        orders=[_serialize_sales_order(o, menus_by_id) for o in orders],
    )


def update_sales_order(
    db: Session,
    *,
    store_id: str,
    order_id: str,
    payload: SalesOrderUpdateRequest,
) -> SalesOrderResponse:
    get_store_or_404(db, store_id)
    conn = _get_or_create_pos_connection(db, store_id=store_id)
    if conn.mode != "CSV_UPLOAD":
        raise AppError(
            status_code=409,
            code="POS_MODE_MANUAL_EDIT_LOCKED",
            message="POS 연동 모드(A/B)에서는 주문 수정 및 환불이 POS 단말에서 자동 동기화됩니다. 직접 수정하려면 CSV 수집 모드로 전환하세요.",
        )

    order = db.scalars(
        select(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .where(SalesOrder.id == order_id, SalesOrder.store_id == store_id)
    ).first()
    if order is None:
        raise AppError(
            status_code=404,
            code="SALES_ORDER_NOT_FOUND",
            message="수정할 판매 주문을 찾을 수 없습니다.",
        )

    if payload.order_status is not None:
        order.status = payload.order_status
        for it in order.items:
            it.status = payload.order_status

    if payload.items is not None:
        items_by_id = {it.id: it for it in order.items}
        for upd in payload.items:
            target = items_by_id.get(upd.item_id)
            if target is None:
                raise AppError(
                    status_code=404,
                    code="SALES_ORDER_ITEM_NOT_FOUND",
                    message="주문 내 해당 품목을 찾을 수 없습니다.",
                )
            target.quantity = upd.quantity

    conn.last_synced_at = utcnow()
    conn.updated_at = utcnow()

    record_audit(
        db,
        store_id=store_id,
        entity_type="sales_order",
        entity_id=order.id,
        action="updated",
        summary={
            "external_order_id": order.external_order_id,
            "order_status": order.status,
            "items": [{"id": it.id, "quantity": it.quantity} for it in order.items],
        },
    )
    db.commit()
    db.refresh(order)

    menus_by_id = {
        m.id: m
        for m in db.scalars(
            select(MenuItem).where(MenuItem.store_id == store_id)
        ).all()
    }
    return _serialize_sales_order(order, menus_by_id)


def create_manual_sales_order(
    db: Session,
    *,
    store_id: str,
    payload: SalesOrderCreateRequest,
) -> SalesOrderResponse:
    get_store_or_404(db, store_id)
    conn = _get_or_create_pos_connection(db, store_id=store_id)
    if conn.mode != "CSV_UPLOAD":
        raise AppError(
            status_code=409,
            code="POS_MODE_MANUAL_EDIT_LOCKED",
            message="POS 연동 모드(A/B)에서는 신규 주문이 POS 단말에서 자동 수집됩니다. 수동 등록하려면 CSV 수집 모드로 전환하세요.",
        )

    menus_by_id = {
        m.id: m
        for m in db.scalars(
            select(MenuItem).where(MenuItem.store_id == store_id)
        ).all()
    }

    now_ts = utcnow()
    ord_dt = payload.ordered_at or now_ts
    if ord_dt.tzinfo is None:
        ord_dt = ord_dt.replace(tzinfo=UTC)

    ext_id = (
        payload.external_order_id.strip()
        if payload.external_order_id and payload.external_order_id.strip()
        else f"MAN-{now_ts.strftime('%Y%m%d-%H%M%S')}-{len(menus_by_id)}"
    )

    # 외부 주문번호 중복 방지
    existing = db.scalars(
        select(SalesOrder).where(
            SalesOrder.store_id == store_id,
            SalesOrder.external_order_id == ext_id,
        )
    ).first()
    if existing is not None:
        ext_id = f"{ext_id}-{now_ts.microsecond // 1000}"

    order = SalesOrder(
        store_id=store_id,
        import_batch_id=None,
        source_mode="CSV_UPLOAD",
        external_order_id=ext_id,
        ordered_at=ord_dt,
        time_basis="order_time",
        status="COMPLETED",
        received_at=now_ts,
    )
    db.add(order)
    db.flush()

    for item_in in payload.items:
        menu = menus_by_id.get(item_in.menu_item_id)
        if menu is None:
            raise AppError(
                status_code=404,
                code="MENU_NOT_FOUND",
                message="주문할 메뉴를 찾을 수 없습니다.",
            )
        u_price = (
            menu.selling_price.quantize(Decimal("0.01"))
            if menu.selling_price is not None
            else Decimal("0.00")
        )
        db.add(
            SalesOrderItem(
                order_id=order.id,
                store_id=store_id,
                menu_item_id=menu.id,
                raw_product_name=menu.name,
                mapping_status="MAPPED",
                quantity=item_in.quantity,
                unit_price=u_price,
                status="COMPLETED",
                ordered_at=ord_dt,
            )
        )

    conn.last_synced_at = now_ts
    if conn.latest_data_time is None or ord_dt > conn.latest_data_time:
        conn.latest_data_time = ord_dt
    conn.updated_at = now_ts

    record_audit(
        db,
        store_id=store_id,
        entity_type="sales_order",
        entity_id=order.id,
        action="created_manual",
        summary={
            "external_order_id": ext_id,
            "item_count": len(payload.items),
        },
    )
    db.commit()

    refreshed = db.scalars(
        select(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .where(SalesOrder.id == order.id)
    ).first()
    assert refreshed is not None
    return _serialize_sales_order(refreshed, menus_by_id)

