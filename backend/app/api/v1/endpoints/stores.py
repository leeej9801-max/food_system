from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.schemas import StoreCreate, StoreResponse, StoreUpdate
from app.schemas.today_summary import TodaySummary
from app.services import demo_seed
from app.services import menus as menu_service
from app.services.today_summary import get_today_summary

router = APIRouter(prefix="/stores", tags=["stores"])


@router.get("/{store_id}/today-summary")
def today_summary(store_id: UUID, db: Annotated[Session, Depends(get_db)]) -> TodaySummary:
    return get_today_summary(db, store_id)


@router.get("")
def get_stores(db: Annotated[Session, Depends(get_db)]) -> list[StoreResponse]:
    return [StoreResponse.model_validate(s) for s in menu_service.list_stores(db)]


@router.post("", status_code=status.HTTP_201_CREATED)
def post_store(payload: StoreCreate, db: Annotated[Session, Depends(get_db)]) -> StoreResponse:
    store = menu_service.create_store(db, payload)
    return StoreResponse.model_validate(store)


@router.get("/{store_id}")
def get_store(store_id: UUID, db: Annotated[Session, Depends(get_db)]) -> StoreResponse:
    store = menu_service.get_store_or_404(db, store_id)
    return StoreResponse.model_validate(store)


@router.patch("/{store_id}")
def patch_store(
    store_id: UUID, payload: StoreUpdate, db: Annotated[Session, Depends(get_db)]
) -> StoreResponse:
    store = menu_service.update_store(db, store_id, payload)
    return StoreResponse.model_validate(store)


@router.post("/{store_id}/seed-western-demo", status_code=status.HTTP_200_OK)
def post_seed_western_demo(
    store_id: UUID, db: Annotated[Session, Depends(get_db)]
) -> dict[str, int]:
    if not settings.demo_seed_enabled and settings.app_env not in {
        "local",
        "development",
        "staging",
        "test",
    }:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return demo_seed.seed_western_bistro_demo(db, store_id=store_id)
