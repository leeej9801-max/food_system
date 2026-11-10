"""안전망 (WO-20261110-002 2단계): 오류 응답 형식과 OpenAPI 스키마를 현재 상태로 고정한다.

리팩토링(반환 타입 정리, Annotated 전환, 계층 분리)이 API 계약을 바꾸지 않았는지 본다.
의도한 계약 변경이면 `UPDATE_OPENAPI_SNAPSHOT=1 uv run pytest tests/api/test_api_contract.py`로
스냅샷을 갱신하고 diff를 리뷰에 남긴다.
"""

import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

SNAPSHOT = Path(__file__).parent / "snapshots" / "openapi.json"


def test_openapi_schema_matches_snapshot(client: TestClient) -> None:
    current = json.dumps(
        client.get("/openapi.json").json(), ensure_ascii=False, indent=2, sort_keys=True
    )
    if os.environ.get("UPDATE_OPENAPI_SNAPSHOT"):
        SNAPSHOT.parent.mkdir(exist_ok=True)
        SNAPSHOT.write_text(current + "\n", encoding="utf-8", newline="\n")

    assert current + "\n" == SNAPSHOT.read_text(encoding="utf-8")


def test_not_found_error_shape(client: TestClient) -> None:
    resp = client.get("/api/v1/stores/00000000-0000-0000-0000-000000000000")

    assert resp.status_code == 404
    assert resp.headers["content-type"] == "application/json"
    body = resp.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "details"}
    assert body["error"]["code"] == "STORE_NOT_FOUND"
    assert body["error"]["details"] == []


def test_conflict_error_shape(client: TestClient) -> None:
    store_id = client.post("/api/v1/stores", json={"name": "매장"}).json()["id"]
    client.post(f"/api/v1/stores/{store_id}/menus", json={"name": "돈까스"})

    resp = client.post(f"/api/v1/stores/{store_id}/menus", json={"name": "돈까스"})

    assert resp.status_code == 409
    assert set(resp.json()["error"]) == {"code", "message", "details"}
    assert resp.json()["error"]["code"] == "DUPLICATE_MENU_NAME"


def test_validation_error_shape(client: TestClient) -> None:
    resp = client.post("/api/v1/stores", json={})

    assert resp.status_code == 422
    error = resp.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"] == [{"field": "name", "message": error["details"][0]["message"]}]
