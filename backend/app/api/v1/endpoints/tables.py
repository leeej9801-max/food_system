from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas import (
    StoreTableCreate,
    StoreTableResponse,
    StoreTableUpdate,
    VisitSessionCreate,
    VisitSessionResponse,
    VisitSessionUpdate,
    VisitSummaryResponse,
)
from app.services import tables as table_service

router = APIRouter(prefix="/stores/{store_id}", tags=["tables & visits"])


@router.get("/tables", response_model=list[StoreTableResponse])
def get_tables(
    store_id: str,
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[StoreTableResponse]:
    return table_service.list_tables(
        db, store_id=store_id, include_inactive=include_inactive
    )


@router.post(
    "/tables", response_model=StoreTableResponse, status_code=status.HTTP_201_CREATED
)
def post_table(
    store_id: str,
    payload: StoreTableCreate,
    db: Session = Depends(get_db),
) -> StoreTableResponse:
    return table_service.create_table(db, store_id=store_id, payload=payload)


@router.patch("/tables/{table_id}", response_model=StoreTableResponse)
def patch_table(
    store_id: str,
    table_id: str,
    payload: StoreTableUpdate,
    db: Session = Depends(get_db),
) -> StoreTableResponse:
    return table_service.update_table(
        db, store_id=store_id, table_id=table_id, payload=payload
    )


@router.get("/visits", response_model=VisitSummaryResponse)
def get_visits(
    store_id: str,
    db: Session = Depends(get_db),
) -> VisitSummaryResponse:
    return table_service.list_visit_summary(db, store_id=store_id)


@router.post(
    "/visits", response_model=VisitSessionResponse, status_code=status.HTTP_201_CREATED
)
def post_visit(
    store_id: str,
    payload: VisitSessionCreate,
    db: Session = Depends(get_db),
) -> VisitSessionResponse:
    return table_service.create_visit_session(db, store_id=store_id, payload=payload)


@router.patch("/visits/{visit_id}", response_model=VisitSessionResponse)
def patch_visit(
    store_id: str,
    visit_id: str,
    payload: VisitSessionUpdate,
    db: Session = Depends(get_db),
) -> VisitSessionResponse:
    return table_service.update_visit_session(
        db, store_id=store_id, visit_id=visit_id, payload=payload
    )
