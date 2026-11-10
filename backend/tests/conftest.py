"""공용 fixture. 같은 이름의 fixture를 직접 정의한 기존 테스트 파일은 자기 것을 쓴다."""

import os
from collections.abc import Generator

# app.core.config를 import하기 전에 정한다. 실제 엔진은 각 fixture가 만든다
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
# TestClient는 http라 Secure 쿠키를 돌려보내지 않는다
os.environ.setdefault("GUEST_COOKIE_SECURE", "false")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import create_app


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    app = create_app()

    def _override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
