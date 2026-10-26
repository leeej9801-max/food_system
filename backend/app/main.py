from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import register_exception_handlers


def create_app() -> FastAPI:
    app = FastAPI(
        title="음식점 AX 데이터 수집·운영 최적화 API",
        version="0.1.0",
        description="1~2인 운영 음식점 데이터 파이프라인 백엔드 (POS 실연동 미검증)",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_prefix)

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "pos_mode": settings.pos_mode,
            "pos_connection_status": "UNVERIFIED",
        }

    return app


app = create_app()
