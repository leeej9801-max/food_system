from collections.abc import Generator

from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.tenancy import RequestContext, bind_store_scope

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def bind_request_scope(db: Session, request: Request) -> None:
    """`/stores/{store_id}/...` 요청이면 그 매장 범위를 세션에 묶는다 (ADR-013)."""
    store_id = request.path_params.get("store_id")
    if store_id:
        bind_store_scope(db, RequestContext(store_id=store_id))


def get_db(request: Request) -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        bind_request_scope(db, request)
        yield db
    finally:
        db.close()
