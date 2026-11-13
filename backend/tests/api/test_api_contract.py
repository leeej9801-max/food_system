"""안전망 (WO-20261110-002 2단계): 오류 응답 형식(RFC 9457, API-004)과 OpenAPI 스키마를 고정한다.

리팩토링(반환 타입 정리, Annotated 전환, 계층 분리)이 API 계약을 바꾸지 않았는지 본다.
의도한 계약 변경이면 `UPDATE_OPENAPI_SNAPSHOT=1 uv run pytest tests/api/test_api_contract.py`로
스냅샷을 갱신하고 diff를 리뷰에 남긴다.
"""

import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

SNAPSHOT = Path(__file__).parent / "snapshots" / "openapi.json"
PROBLEM_KEYS = {"type", "title", "status", "detail", "instance", "code", "errors"}
PROBLEM_TYPE = "application/problem+json"


def test_openapi_schema_matches_snapshot(client: TestClient) -> None:
    current = json.dumps(
        client.get("/openapi.json").json(), ensure_ascii=False, indent=2, sort_keys=True
    )
    if os.environ.get("UPDATE_OPENAPI_SNAPSHOT"):
        SNAPSHOT.parent.mkdir(exist_ok=True)
        SNAPSHOT.write_text(current + "\n", encoding="utf-8", newline="\n")

    assert current + "\n" == SNAPSHOT.read_text(encoding="utf-8")


def test_not_found_error_shape(client: TestClient) -> None:
    path = "/api/v1/stores/00000000-0000-0000-0000-000000000000"
    resp = client.get(path)

    assert resp.status_code == 404
    assert resp.headers["content-type"] == PROBLEM_TYPE
    body = resp.json()
    assert set(body) == PROBLEM_KEYS
    assert body["type"] == "about:blank"
    assert body["title"] == "Not Found"
    assert body["status"] == 404
    assert body["instance"] == path
    assert body["code"] == "STORE_NOT_FOUND"
    assert body["detail"]
    assert body["errors"] == []


def test_conflict_error_shape(client: TestClient) -> None:
    store_id = client.post("/api/v1/stores", json={"name": "매장"}).json()["id"]
    client.post(f"/api/v1/stores/{store_id}/menus", json={"name": "돈까스"})

    resp = client.post(f"/api/v1/stores/{store_id}/menus", json={"name": "돈까스"})

    assert resp.status_code == 409
    assert resp.headers["content-type"] == PROBLEM_TYPE
    assert set(resp.json()) == PROBLEM_KEYS
    assert resp.json()["code"] == "DUPLICATE_MENU_NAME"


def test_validation_error_shape(client: TestClient) -> None:
    resp = client.post("/api/v1/stores", json={})

    assert resp.status_code == 422
    assert resp.headers["content-type"] == PROBLEM_TYPE
    body = resp.json()
    assert set(body) == PROBLEM_KEYS
    assert body["code"] == "VALIDATION_ERROR"
    assert body["errors"] == [{"field": "name", "message": body["errors"][0]["message"]}]


def test_unknown_route_and_method_use_problem_format(client: TestClient) -> None:
    missing = client.get("/api/v1/no-such-route")
    assert missing.status_code == 404
    assert missing.headers["content-type"] == PROBLEM_TYPE
    assert missing.json()["code"] == "HTTP_ERROR"

    wrong_method = client.delete("/health")
    assert wrong_method.status_code == 405
    assert set(wrong_method.json()) == PROBLEM_KEYS


def test_unhandled_error_is_problem_without_internals() -> None:
    app = create_app()

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("secret internal detail")

    resp = TestClient(app, raise_server_exceptions=False).get("/boom")

    assert resp.status_code == 500
    assert resp.headers["content-type"] == PROBLEM_TYPE
    assert resp.json()["code"] == "INTERNAL_ERROR"
    assert "secret" not in resp.text
