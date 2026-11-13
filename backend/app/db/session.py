from collections.abc import Generator
from uuid import UUID

from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.tenancy import RequestContext, bind_store_scope

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

# 끊긴 연결(DB 재시작, 유휴 종료)을 빌려주기 전에 걸러낸다
engine = create_engine(
    settings.database_url, connect_args=connect_args, future=True, pool_pre_ping=True
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def bind_request_scope(db: Session, request: Request) -> None:
    """`/stores/{store_id}/...` 요청이면 그 매장 범위를 세션에 묶는다 (ADR-013)."""
    try:
        store_id = UUID(request.path_params["store_id"])
    except (KeyError, ValueError):
        return  # 경로에 매장이 없거나 형식이 틀렸다. 뒤쪽은 FastAPI 경로 검증이 422로 막는다
    bind_store_scope(db, RequestContext(store_id=store_id))


def get_db(request: Request) -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        bind_request_scope(db, request)
        yield db
    finally:
        db.close()
