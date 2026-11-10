"""천문연 특일정보(공휴일)를 연 단위로 가져와 holidays 표에 넣는다 (U-28). 연 1회 실행.

    KASI_SERVICE_KEY=<키> uv run python -m scripts.fetch_holidays 2026

임시공휴일이 발표되면 다시 실행하거나 POST /api/v1/holidays로 직접 더한다.
인증키는 .env에서 읽고 출력하지 않는다. 응답 형식은 공공데이터포털 문서 기준이며
실제 키로는 아직 확인하지 못했다(미검증).
"""

import json
import sys
import urllib.parse
import urllib.request
from datetime import date

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.holidays import upsert_holidays

ENDPOINT = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"


def parse_response(payload: dict) -> list[tuple[date, str]]:
    """getRestDeInfo JSON 응답 → [(날짜, 이름)]. 항목이 하나면 dict, 없으면 빈 문자열로 온다."""
    header = payload.get("response", {}).get("header", {})
    if header.get("resultCode") not in (None, "00"):
        raise RuntimeError(f"KASI error {header.get('resultCode')}: {header.get('resultMsg')}")
    items = payload["response"]["body"].get("items") or {}
    rows = items.get("item", []) if isinstance(items, dict) else []
    if isinstance(rows, dict):
        rows = [rows]
    result = []
    for row in rows:
        if row.get("isHoliday", "Y") != "Y":
            continue
        raw = str(row["locdate"])
        result.append((date(int(raw[:4]), int(raw[4:6]), int(raw[6:8])), str(row["dateName"])))
    return result


def fetch_year(year: int, service_key: str) -> list[tuple[date, str]]:
    query = urllib.parse.urlencode({"solYear": year, "numOfRows": 100, "_type": "json"})
    # 포털이 주는 키는 이미 인코딩된 경우가 있어 그대로 붙인다
    url = f"{ENDPOINT}?serviceKey={service_key}&{query}"
    with urllib.request.urlopen(url, timeout=15) as resp:
        return parse_response(json.loads(resp.read().decode("utf-8")))


def main(argv: list[str]) -> int:
    if len(argv) < 2 or not argv[1].isdigit():
        print(__doc__)
        return 2
    if not settings.kasi_service_key:
        print("KASI_SERVICE_KEY is not set (backend/.env)")
        return 1
    items = fetch_year(int(argv[1]), settings.kasi_service_key)
    db = SessionLocal()
    try:
        changed = upsert_holidays(db, items, source="KASI")
    finally:
        db.close()
    print(f"holidays {argv[1]}: fetched={len(items)} changed={changed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
