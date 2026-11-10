"""ADR-013 B안 성능 확인: 같은 데이터·같은 쿼리를 RLS 없는 테이블과 RLS 테이블에서 비교한다.

사용: RLS_TEST_DATABASE_URL=postgresql+psycopg://<owner>@host:port/db python scripts/rls_benchmark.py
일회용 rls_bench 스키마를 만들고 끝나면 지운다. 로컬 단일 실행 수치라 운영 성능을 보장하지 않는다.
"""

import os
import secrets
import statistics
import sys
import time

from sqlalchemy import create_engine, make_url, text

STORES = 50
ROWS_PER_STORE = 20_000
RUNS = 30
ROLE = "rls_bench_runtime"

SETUP = """
DROP SCHEMA IF EXISTS rls_bench CASCADE;
CREATE SCHEMA rls_bench;
CREATE TABLE rls_bench.stores (n int PRIMARY KEY, id uuid NOT NULL);
INSERT INTO rls_bench.stores SELECT n, gen_random_uuid() FROM generate_series(1, {stores}) n;
CREATE TABLE rls_bench.visits_plain AS
    SELECT gen_random_uuid() AS id, s.id AS store_id,
           (random() * 8)::int + 1 AS party_size,
           now() - (random() * interval '60 days') AS seated_at
    FROM rls_bench.stores s, generate_series(1, {rows}) g;
CREATE TABLE rls_bench.visits_rls AS SELECT * FROM rls_bench.visits_plain;
CREATE INDEX ON rls_bench.visits_plain (store_id, seated_at);
CREATE INDEX ON rls_bench.visits_rls (store_id, seated_at);
ALTER TABLE rls_bench.visits_rls ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_bench.visits_rls FORCE ROW LEVEL SECURITY;
CREATE POLICY store_isolation ON rls_bench.visits_rls
    USING (store_id = nullif(current_setting('app.current_store_id', true), '')::uuid);
ANALYZE rls_bench.visits_plain;
ANALYZE rls_bench.visits_rls;
GRANT USAGE ON SCHEMA rls_bench TO {role};
GRANT SELECT ON ALL TABLES IN SCHEMA rls_bench TO {role};
"""

# 분석 화면과 비슷한 집계: 한 매장의 최근 30일 시간대별 방문·인원
AGG = (
    "SELECT extract(hour FROM seated_at) h, count(*), sum(party_size) FROM rls_bench.{table} "
    "WHERE {where} seated_at > now() - interval '30 days' GROUP BY 1"
)
CASES = {
    "plain + 앱 필터 (A안)": AGG.format(table="visits_plain", where="store_id = :s AND"),
    "RLS + 앱 필터 (B안)": AGG.format(table="visits_rls", where="store_id = :s AND"),
    "RLS만 (앱 필터 누락)": AGG.format(table="visits_rls", where=""),
}


def main() -> int:
    owner_url = os.environ.get("RLS_TEST_DATABASE_URL")
    if not owner_url:
        print("RLS_TEST_DATABASE_URL 미설정", file=sys.stderr)
        return 1
    owner = create_engine(owner_url)
    password = secrets.token_hex(16)
    with owner.begin() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": ROLE}
        ).first()
        verb = "ALTER" if exists else "CREATE"
        conn.execute(
            text(f"{verb} ROLE {ROLE} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{password}'")
        )
        conn.exec_driver_sql(SETUP.format(stores=STORES, rows=ROWS_PER_STORE, role=ROLE))
        store = conn.execute(text("SELECT id FROM rls_bench.stores WHERE n = 1")).scalar_one()

    runtime = create_engine(make_url(owner_url).set(username=ROLE, password=password))
    print(f"rows={STORES * ROWS_PER_STORE:,} stores={STORES} runs={RUNS}")
    try:
        for label, sql in CASES.items():
            times, rows = [], None
            with runtime.connect() as conn:
                for i in range(RUNS + 3):
                    with conn.begin():
                        conn.execute(
                            text("SELECT set_config('app.current_store_id', :s, true)"),
                            {"s": str(store)},
                        )
                        t0 = time.perf_counter()
                        result = conn.execute(text(sql), {"s": store}).all()
                        if i >= 3:  # 앞의 3회는 캐시 워밍업
                            times.append((time.perf_counter() - t0) * 1000)
                        rows = sum(r[1] for r in result)
            print(
                f"{label:<22} median {statistics.median(times):7.2f} ms  "
                f"p95 {sorted(times)[int(RUNS * 0.95) - 1]:7.2f} ms  visits={rows}"
            )
    finally:
        runtime.dispose()
        with owner.begin() as conn:
            conn.execute(text("DROP SCHEMA IF EXISTS rls_bench CASCADE"))
        owner.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
