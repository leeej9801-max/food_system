"""기상청 API허브 AWS 매분자료로 지난 날씨를 weather_daily 표에 넣는다 (U-28, U-56).

    uv run python -m scripts.fetch_weather 2026-11-01 2026-11-15

키(KMA_APIHUB_KEY)와 지점번호(KMA_STATION_ID, 부천 433)는 backend/.env에서 읽고 출력하지 않는다.
손익 화면의 GET /weather도 빠진 날을 받아 채우므로, 이 스크립트는 지난 기간을 한꺼번에 채울 때 쓴다.
"""

import sys
from datetime import date, datetime
from functools import partial
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.weather import fetch_aws_day, month_weather

MAX_DAYS = 366


def main(argv: list[str]) -> int:
    try:
        start, end = date.fromisoformat(argv[1]), date.fromisoformat(argv[2])
    except (IndexError, ValueError):
        print(__doc__)
        return 2
    if start > end or (end - start).days >= MAX_DAYS:
        print(f"range must be start<=end and under {MAX_DAYS} days")
        return 2
    if not settings.kma_apihub_key or not settings.kma_station_id:
        print("KMA_APIHUB_KEY or KMA_STATION_ID is not set (backend/.env)")
        return 1
    station, key = settings.kma_station_id, settings.kma_apihub_key
    today = datetime.now(ZoneInfo(settings.app_timezone)).date()
    db = SessionLocal()
    try:
        # 빠진 날만 나눠 받고, 시간초과 난 날은 건너뛴다(다시 돌리면 그날만 받는다)
        got = month_weather(
            db, station, start, end, today, partial(fetch_aws_day, station_id=station, auth_key=key)
        )
    finally:
        db.close()
    print(f"weather {start}..{end}: days_with_data={len(got)} of {(end - start).days + 1}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
