-- ADR-013 B안 스파이크용 스키마 (기존 운영 스키마와 분리된 rls_spike 스키마에서만 사용).
-- 매장 테이블: store_id 컬럼 + RLS(FORCE). 전역 테이블: store_id 없음, RLS 없음.
-- {runtime_role} 은 테스트 fixture가 채운다.

DROP SCHEMA IF EXISTS rls_spike CASCADE;
CREATE SCHEMA rls_spike;

-- 전역(플랫폼) 영역: 캐릭터·손님 ID는 매장에 묶지 않는다 (U-18)
CREATE TABLE rls_spike.guest_profiles (
    id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rls_spike.characters (
    id uuid PRIMARY KEY,
    guest_profile_id uuid REFERENCES rls_spike.guest_profiles(id),
    appearance jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- 매장 영역
CREATE TABLE rls_spike.store_tables (
    id uuid PRIMARY KEY,
    store_id uuid NOT NULL,
    name text NOT NULL
);
CREATE TABLE rls_spike.visit_sessions (
    id uuid PRIMARY KEY,
    store_id uuid NOT NULL,
    table_id uuid NOT NULL REFERENCES rls_spike.store_tables(id),
    party_size int NOT NULL,
    character_id uuid REFERENCES rls_spike.characters(id),
    seated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON rls_spike.store_tables (store_id);
CREATE INDEX ON rls_spike.visit_sessions (store_id, seated_at);

-- 매장 범위가 없으면 current_setting(..., true)가 NULL → 비교가 NULL → 0행 (fail-closed)
CREATE FUNCTION rls_spike.current_store_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('app.current_store_id', true), '')::uuid $$;

ALTER TABLE rls_spike.store_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_spike.store_tables FORCE ROW LEVEL SECURITY;
CREATE POLICY store_isolation ON rls_spike.store_tables
    USING (store_id = rls_spike.current_store_id())
    WITH CHECK (store_id = rls_spike.current_store_id());

ALTER TABLE rls_spike.visit_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_spike.visit_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY store_isolation ON rls_spike.visit_sessions
    USING (store_id = rls_spike.current_store_id())
    WITH CHECK (store_id = rls_spike.current_store_id());

GRANT USAGE ON SCHEMA rls_spike TO {runtime_role};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA rls_spike TO {runtime_role};
GRANT EXECUTE ON FUNCTION rls_spike.current_store_id() TO {runtime_role};
