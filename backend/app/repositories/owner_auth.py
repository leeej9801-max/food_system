from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.db.models import Store
from app.db.models.owner_auth import (
    OwnerAccount,
    OwnerOAuthState,
    OwnerRefresh,
    OwnerSession,
    OwnerStore,
)


def add(db: Session, row) -> None:
    db.add(row)
    db.flush()


def oauth_state(db: Session, state_hash: str) -> OwnerOAuthState | None:
    return db.scalar(
        select(OwnerOAuthState).where(OwnerOAuthState.state_hash == state_hash).with_for_update()
    )


def owner(db: Session, *, owner_id: UUID | None = None, kakao_id: str | None = None):
    query = select(OwnerAccount)
    if owner_id is not None:
        query = query.where(OwnerAccount.id == owner_id)
    if kakao_id is not None:
        query = query.where(OwnerAccount.kakao_id == kakao_id)
    return db.scalar(query)


def stores(db: Session, owner_id: UUID) -> list[Store]:
    return list(
        db.scalars(
            select(Store)
            .join(OwnerStore, OwnerStore.store_id == Store.id)
            .where(OwnerStore.owner_id == owner_id)
            .order_by(Store.created_at)
        )
    )


def any_link(db: Session) -> bool:
    return db.scalar(select(OwnerStore.owner_id).limit(1)) is not None


def only_store(db: Session) -> Store | None:
    if db.scalar(select(func.count()).select_from(Store)) != 1:
        return None
    return db.scalar(select(Store))


def session(db: Session, session_id: UUID) -> OwnerSession | None:
    return db.scalar(
        select(OwnerSession)
        .where(OwnerSession.id == session_id)
        .execution_options(populate_existing=True)
    )


def refresh(db: Session, token_hash: str, *, lock=False) -> OwnerRefresh | None:
    query = select(OwnerRefresh).where(OwnerRefresh.token_hash == token_hash)
    if lock:
        query = query.with_for_update()
    return db.scalar(query.execution_options(populate_existing=True))


def revoke_owner(db: Session, owner_id: UUID, now: datetime):
    db.execute(
        update(OwnerSession)
        .where(OwnerSession.owner_id == owner_id, OwnerSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
