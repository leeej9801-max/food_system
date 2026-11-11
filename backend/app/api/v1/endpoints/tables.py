from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import (
    SlotProfileUpdate,
    StoreTableCreate,
    StoreTableResponse,
    StoreTableUpdate,
    TableQrTokenResponse,
    VisitSessionCreate,
    VisitSessionResponse,
    VisitSessionUpdate,
    VisitSummaryResponse,
)
from app.services import floor as floor_service
from app.services import guest as guest_service
from app.services import tables as table_service

router = APIRouter(prefix="/stores/{store_id}", tags=["tables & visits"])


@router.get("/tables")
def get_tables(
    store_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    include_inactive: Annotated[bool, Query()] = False,
) -> list[StoreTableResponse]:
    return table_service.list_tables(db, store_id=store_id, include_inactive=include_inactive)


@router.post("/tables", status_code=status.HTTP_201_CREATED)
def post_table(
    store_id: UUID,
    payload: StoreTableCreate,
    db: Annotated[Session, Depends(get_db)],
) -> StoreTableResponse:
    return table_service.create_table(db, store_id=store_id, payload=payload)


@router.patch("/tables/{table_id}")
def patch_table(
    store_id: UUID,
    table_id: UUID,
    payload: StoreTableUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> StoreTableResponse:
    return table_service.update_table(db, store_id=store_id, table_id=table_id, payload=payload)


@router.post("/floor/reset")
def reset_floor(
    store_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> list[StoreTableResponse]:
    """홀 배치를 매장 도면(meal_love 프리셋)으로 되돌린다 (WO-20261111-001)."""
    floor_service.apply_floor_preset(db, store_id, "meal_love")
    return table_service.list_tables(db, store_id=store_id)


@router.get("/visits")
def get_visits(
    store_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> VisitSummaryResponse:
    return table_service.list_visit_summary(db, store_id=store_id)


@router.post("/visits", status_code=status.HTTP_201_CREATED)
def post_visit(
    store_id: UUID,
    payload: VisitSessionCreate,
    db: Annotated[Session, Depends(get_db)],
) -> VisitSessionResponse:
    return table_service.create_visit_session(db, store_id=store_id, payload=payload)


@router.patch("/visits/{visit_id}")
def patch_visit(
    store_id: UUID,
    visit_id: UUID,
    payload: VisitSessionUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> VisitSessionResponse:
    return table_service.update_visit_session(
        db, store_id=store_id, visit_id=visit_id, payload=payload
    )


@router.patch("/visits/{visit_id}/slots/{slot_no}")
def patch_visit_slot(
    store_id: UUID,
    visit_id: UUID,
    slot_no: int,
    payload: SlotProfileUpdate,
    db: Annotated[Session, Depends(get_db)],
) -> VisitSessionResponse:
    return table_service.update_slot_profile(
        db, store_id=store_id, visit_id=visit_id, slot_no=slot_no, payload=payload
    )


@router.get("/tables/{table_id}/qr-token")
def get_table_qr_token(
    store_id: UUID,
    table_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> TableQrTokenResponse:
    table_service.get_table_or_404(db, store_id=store_id, table_id=table_id)
    return guest_service.get_qr_token(db, store_id=store_id, table_id=table_id)


@router.post("/tables/{table_id}/qr-token")
def rotate_table_qr_token(
    store_id: UUID,
    table_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> TableQrTokenResponse:
    """QR 토큰 발급 또는 회전. 회전하면 이전 QR은 바로 못 쓴다."""
    table_service.get_table_or_404(db, store_id=store_id, table_id=table_id)
    return guest_service.issue_qr_token(db, store_id=store_id, table_id=table_id)
