"""매장 간 데이터 격리(ADR-013 B안): 요청 컨텍스트 + 트랜잭션 단위 매장 범위.

베타(P-05)는 로그인이 없으므로 컨텍스트를 고정 actor로 만들지만, 서비스·리포지토리는
처음부터 이 컨텍스트만 받게 해서 나중에 인증을 붙일 때 `authorize`만 바꾼다.
"""

from dataclasses import dataclass

from sqlalchemy import event, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

# RLS 정책이 읽는 세션 변수 이름 (alembic 0006, tests/isolation/rls_policies.sql과 같아야 한다)
STORE_SCOPE_SETTING = "app.current_store_id"
_CTX_KEY = "tenant_ctx"


@dataclass(frozen=True)
class RequestContext:
    store_id: str
    actor: str = "beta-staff"  # PROVISIONAL (P-05): 인증 도입 시 로그인 사용자로 교체


def authorize(ctx: RequestContext, store_id: str) -> None:
    """베타에서는 모두 허용. 인증 도입 시 여기서 ctx.actor의 매장 권한을 검사한다."""


def _apply(connection: Connection, ctx: RequestContext) -> None:
    # SQLite에는 set_config도 RLS도 없다 (P-07)
    if connection.dialect.name != "postgresql":
        return
    connection.execute(
        text("SELECT set_config(:name, :value, true)"),
        {"name": STORE_SCOPE_SETTING, "value": ctx.store_id},
    )


def bind_store_scope(db: Session, ctx: RequestContext) -> None:
    """세션에 매장 범위를 묶는다. 이후 시작되는 모든 트랜잭션에 다시 걸린다.

    범위는 트랜잭션 단위(SET LOCAL)라 커넥션 풀의 다음 요청으로 새지 않는다.
    """
    authorize(ctx, ctx.store_id)
    db.info[_CTX_KEY] = ctx
    if db.in_transaction():
        _apply(db.connection(), ctx)


def apply_store_scope(db: Session, ctx: RequestContext) -> None:
    """현재 트랜잭션에만 매장 범위를 건다 (스파이크 테스트용)."""
    authorize(ctx, ctx.store_id)
    _apply(db.connection(), ctx)


@event.listens_for(Session, "after_begin")
def _reapply_store_scope(session: Session, transaction, connection: Connection) -> None:
    # 서비스가 중간에 commit()하면 새 트랜잭션이 시작되므로 범위를 다시 건다
    ctx = session.info.get(_CTX_KEY)
    if ctx is not None:
        _apply(connection, ctx)
