from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.guest.router import guest_router
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import PROBLEM_RESPONSES, problem_response, register_exception_handlers
from app.core.staff_security import install_log_redaction


def create_app() -> FastAPI:
    install_log_redaction()
    app = FastAPI(
        title="음식점 AX 데이터 수집·운영 최적화 API",
        version="0.1.0",
        description="1~2인 운영 음식점 데이터 파이프라인 백엔드 (POS 실연동 미검증)",
        responses=PROBLEM_RESPONSES,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)

    @app.middleware("http")
    async def private_staff_responses(request, call_next):
        sensitive = (
            "/staff-access" in request.url.path
            or "/auth/kakao" in request.url.path
            or "/attendance/" in request.url.path
        )
        try:
            response = await call_next(request)
        except Exception:
            if not sensitive:
                raise
            # ServerErrorMiddleware의 재전파로 uvicorn이 SQL/토큰 traceback을 출력하지 않게 한다.
            response = problem_response(request, 500, "INTERNAL_ERROR", "서버 오류가 발생했습니다.")
        if sensitive:
            response.headers["Cache-Control"] = "no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
        return response

    app.include_router(api_router, prefix=settings.api_prefix)
    app.include_router(guest_router, prefix=settings.guest_api_prefix)

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "pos_mode": settings.pos_mode,
            "pos_connection_status": "UNVERIFIED",
        }

    return app


app = create_app()
