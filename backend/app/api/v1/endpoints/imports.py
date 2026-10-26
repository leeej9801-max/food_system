from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import (
    CsvCommitResponse,
    CsvPreviewRequest,
    CsvPreviewResponse,
    IntegrationStatusResponse,
    PosModeUpdateRequest,
    ProductMappingResponse,
    ProductMappingUpsertRequest,
    SalesOrderCreateRequest,
    SalesOrderResponse,
    SalesOrdersListResponse,
    SalesOrderUpdateRequest,
)
from app.services import imports as import_service

router = APIRouter(prefix="/stores/{store_id}", tags=["integrations", "imports"])


@router.get("/integrations/status", response_model=IntegrationStatusResponse)
def get_integration_status_endpoint(
    store_id: str,
    db: Session = Depends(get_db),
) -> IntegrationStatusResponse:
    return import_service.get_integration_status(db, store_id=store_id)


@router.patch("/integrations/mode", response_model=IntegrationStatusResponse)
def update_pos_mode_endpoint(
    store_id: str,
    payload: PosModeUpdateRequest,
    db: Session = Depends(get_db),
) -> IntegrationStatusResponse:
    return import_service.update_pos_mode(db, store_id=store_id, payload=payload)


@router.get("/imports/sales-csv/sample")
def get_sample_sales_csv_endpoint(store_id: str) -> dict[str, str]:
    return {
        "file_name": "sample_western_bistro_sales.csv",
        "csv_text": import_service.get_sample_sales_csv(),
    }


@router.post(
    "/imports/sales-csv/preview",
    response_model=CsvPreviewResponse,
    status_code=status.HTTP_200_OK,
)
def preview_sales_csv_endpoint(
    store_id: str,
    payload: CsvPreviewRequest,
    db: Session = Depends(get_db),
) -> CsvPreviewResponse:
    return import_service.preview_sales_csv(db, store_id=store_id, payload=payload)


@router.post(
    "/imports/sales-csv/{batch_id}/commit",
    response_model=CsvCommitResponse,
    status_code=status.HTTP_200_OK,
)
def commit_sales_csv_endpoint(
    store_id: str,
    batch_id: str,
    db: Session = Depends(get_db),
) -> CsvCommitResponse:
    return import_service.commit_sales_csv(db, store_id=store_id, batch_id=batch_id)


@router.get("/integrations/mappings", response_model=list[ProductMappingResponse])
def list_product_mappings_endpoint(
    store_id: str,
    db: Session = Depends(get_db),
) -> list[ProductMappingResponse]:
    return import_service.list_product_mappings(db, store_id=store_id)


@router.post(
    "/integrations/mappings",
    response_model=ProductMappingResponse,
    status_code=status.HTTP_200_OK,
)
def upsert_product_mapping_endpoint(
    store_id: str,
    payload: ProductMappingUpsertRequest,
    db: Session = Depends(get_db),
) -> ProductMappingResponse:
    return import_service.upsert_product_mapping(
        db, store_id=store_id, payload=payload
    )


@router.get("/sales-orders", response_model=SalesOrdersListResponse)
def list_sales_orders_endpoint(
    store_id: str,
    db: Session = Depends(get_db),
) -> SalesOrdersListResponse:
    return import_service.list_sales_orders(db, store_id=store_id)


@router.post(
    "/sales-orders",
    response_model=SalesOrderResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_manual_sales_order_endpoint(
    store_id: str,
    payload: SalesOrderCreateRequest,
    db: Session = Depends(get_db),
) -> SalesOrderResponse:
    return import_service.create_manual_sales_order(
        db, store_id=store_id, payload=payload
    )


@router.patch("/sales-orders/{order_id}", response_model=SalesOrderResponse)
def update_sales_order_endpoint(
    store_id: str,
    order_id: str,
    payload: SalesOrderUpdateRequest,
    db: Session = Depends(get_db),
) -> SalesOrderResponse:
    return import_service.update_sales_order(
        db, store_id=store_id, order_id=order_id, payload=payload
    )

