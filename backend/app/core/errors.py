import logging
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException

logger = logging.getLogger(__name__)

PROBLEM_MEDIA_TYPE = "application/problem+json"


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or []


class FieldError(BaseModel):
    field: str
    message: str


class Problem(BaseModel):
    """RFC 9457 오류 본문. `code`와 `errors`는 확장 필드다 (API-004)."""

    type: str = "about:blank"
    title: str
    status: int
    detail: str
    instance: str
    code: str
    errors: list[FieldError] = []


# FastAPI 기본 422(HTTPValidationError) 대신 실제 본문을 OpenAPI에 선언한다
PROBLEM_RESPONSES: dict[int | str, dict[str, Any]] = {
    422: {
        "description": "Validation Error",
        "content": {PROBLEM_MEDIA_TYPE: {"schema": {"$ref": "#/components/schemas/Problem"}}},
    }
}


def problem_response(
    request: Request,
    status_code: int,
    code: str,
    detail: str,
    errors: list[dict[str, Any]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    try:
        title = HTTPStatus(status_code).phrase
    except ValueError:
        title = "HTTP Error"
    return JSONResponse(
        status_code=status_code,
        media_type=PROBLEM_MEDIA_TYPE,
        headers=headers,
        content={
            "type": "about:blank",
            "title": title,
            "status": status_code,
            "detail": detail,
            "instance": request.url.path,
            "code": code,
            "errors": errors or [],
        },
    )


def _add_problem_schema(app: FastAPI) -> None:
    """PROBLEM_RESPONSES가 가리키는 Problem 스키마를 OpenAPI components에 넣는다."""
    build = app.openapi

    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            schemas = build().setdefault("components", {}).setdefault("schemas", {})
            problem = Problem.model_json_schema(ref_template="#/components/schemas/{model}")
            schemas.update(problem.pop("$defs", {}))
            schemas["Problem"] = problem
        return app.openapi_schema

    app.openapi = openapi


def register_exception_handlers(app: FastAPI) -> None:
    _add_problem_schema(app)

    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        return problem_response(request, exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details: list[dict[str, Any]] = []
        for err in exc.errors():
            loc = [
                str(part) for part in err.get("loc", []) if part not in ("body", "query", "path")
            ]
            field = ".".join(loc) if loc else "request"
            details.append({"field": field, "message": err.get("msg", "유효하지 않은 입력입니다.")})
        return problem_response(
            request, 422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", details
        )

    # 없는 경로(404), 허용되지 않는 메서드(405) 등 프레임워크가 내는 오류
    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, exc: HTTPException) -> JSONResponse:
        headers = dict(exc.headers) if exc.headers else None
        return problem_response(
            request, exc.status_code, "HTTP_ERROR", str(exc.detail), headers=headers
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.error("Unhandled error: %s %s", request.method, request.url.path, exc_info=exc)
        return problem_response(request, 500, "INTERNAL_ERROR", "서버 오류가 발생했습니다.")
