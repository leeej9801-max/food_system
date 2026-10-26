---
id: IR-20261025-001
type: implementation-report
status: DONE
created: 2026-10-25
updated: 2026-10-25
source_of_truth: false
work_order: "[[WO-20261025-001_첫번째_vertical_slice]]"
review: "[[REV-20261025-001_첫번째_vertical_slice]]"
test_record: "[[TEST-20261025-001_첫번째_vertical_slice]]"
related:
  - "[[음식점_AX_통합기획서_v1.0]]"
  - "[[음식점_AX_기술아키텍처_선정및구조_v1.0]]"
  - "[[음식점_AX_UI명세서_v0.1]]"
  - "[[결정사항_로그]]"
tags: [implementation-report]
---

# IR-20261025-001 — 첫 번째 vertical slice (프로젝트 골격 + 메뉴 관리 최소 CRUD)

| ID | 상태 | 작성일 | 관련 문서 | 관련 작업 | 관련 결정 |
|---|---|---|---|---|---|
| IR-20261025-001 | DONE | 2026-10-25 | [[음식점_AX_통합기획서_v1.0]], [[음식점_AX_UI명세서_v0.1]], [[음식점_AX_기술아키텍처_선정및구조_v1.0]] | [[WO-20261025-001_첫번째_vertical_slice]] | ADR-001~003, ADR-010, U-01~05, P-01~09 |

## 1. 실제 구현한 요구사항 / 화면 / 결정 ID

- **요구사항:** `REQ-005` (메뉴 마스터 등록·수정·비활성화, 주 대상), `REQ-001` (매장 최소 생성, P-04), `REQ-013` (메뉴 생성·수정·비활성화 감사 로그 `audit_events`) — [[요구사항_ID_매핑]]
- **화면 ID:** `S03` (메뉴 관리 — 목록, 검색/카테고리/상태 필터, 추가·수정 모달, 비활성화/재활성화), `S00` (매장 미존재 시 최소 매장 생성 폼)
- **적용 결정:** `ADR-001`, `ADR-002`, `ADR-003`, `ADR-010`, 사용자 확정 `U-01~U-05`, 임시 가정 `P-01~P-09` ([[결정사항_로그]])

## 2. 변경 파일 및 중요한 변경 요약

### 루트 및 인프라
- `AGENTS.md`: 코딩 에이전트 진입점 및 `DOCS/05_운영/개발에이전트_작업규약.md` 연결
- `README.md`: 로컬 실행·마이그레이션·테스트·Vault 링크 검사 방법 안내
- `.gitignore`: Python/Node/환경변수/로컬 DB 파일 제외
- `db/docker-compose.yml`: PostgreSQL 17 로컬 개발 컨테이너 구성

### 백엔드 (`backend/`)
- `pyproject.toml`, `.env.example`, `alembic.ini`, `alembic/env.py`, `alembic/versions/0001_initial_menus.py`
- `app/core/config.py`: 환경변수 설정(`API_PREFIX=/api/v1`, `DATABASE_URL`, `APP_TIMEZONE=Asia/Seoul`)
- `app/core/errors.py`: 일관된 오류 응답(`{ "error": { "code", "message", "details" } }`) 및 422 필드별 검증 오류 핸들러
- `app/db/base.py`, `app/db/session.py`, `app/db/models/__init__.py`: `Store`, `MenuItem` (`Numeric(12, 2)`, `is_active`), `AuditEvent`
- `app/schemas/__init__.py`: `StoreCreate/Response`, `MenuCreate/Update/Response` (`pos_mapping_status="UNLINKED_PROVISIONAL"`, `recipe_status="UNREGISTERED"`)
- `app/services/menus.py`: 매장 범위 격리(`store_id`), 활성 메뉴명 중복 방지(409, P-01), 물리 삭제 없는 비활성화/재활성화(P-06), 감사 로그 기록
- `app/api/v1/endpoints/stores.py`, `app/api/v1/endpoints/menus.py`, `app/api/v1/router.py`, `app/main.py`
- `tests/api/test_menus_api.py`: 수용 기준 AC-1 ~ AC-8 자동 테스트 7개

### 프론트엔드 (`frontend/`)
- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.env.example`, `src/vite-env.d.ts`, `src/index.css`
- `src/types/index.ts`, `src/api/client.ts`, `src/api/stores.ts`, `src/api/menus.ts`
- `src/lib/menuValidation.ts`, `src/lib/menuValidation.test.ts`: 폼 검증 및 원화 표시 포맷 함수 + 단위 테스트 5개
- `src/components/MenuFormModal.tsx`: 추가/수정 모달, 저장 중/실패 상태 표시, 실패 시 입력값 보존, 미저장 닫기 확인
- `src/pages/MenuManagementPage.tsx`: S03 메뉴 관리 테이블, 검색·카테고리·상태 필터, 빈 상태 안내(가짜 샘플 숫자 금지 준수), 활성/비활성 전환
- `src/app/App.tsx`, `src/main.tsx`: S00 최소 매장 생성 분기, 좌측 내비게이션 레이아웃, 미구현 화면 정직한 안내

## 3. 실행 명령 / 환경 변수 (비밀 값 제외)

- 환경 변수 예시(`backend/.env.example`, `frontend/.env.example`):
  - `API_PREFIX=/api/v1`
  - `DATABASE_URL=postgresql+psycopg://app_user:change_me_local_only@localhost:5432/restaurant_ax` (기본 fallback: `sqlite:///./local_dev.db`)
  - `VITE_API_BASE_URL=http://localhost:8000/api/v1`
- 실행 명령은 루트 `README.md` 참조.

## 4. 실행한 테스트와 결과

상세 로그는 [[TEST-20261025-001_첫번째_vertical_slice]] 참조.
- `alembic upgrade head` (SQLite): **PASS** (`0001_initial_menus`)
- `ruff check .`: **PASS** (`All checks passed!`)
- `pytest -v`: **PASS** (`7 passed`)
- `npm run typecheck`: **PASS**
- `npm run test` (vitest): **PASS** (`5 passed`)
- `npm run build`: **PASS**

## 5. 구현하지 못한 요구사항 / 차이 / 이유

- **S00 전체 4단계 매장 생성 마법사 및 테이블 자동 배치(REQ-001 전체, REQ-002):** 첫 vertical slice의 목적이 메뉴 관리 CRUD(REQ-005)이므로, `store_id` 확보에 필요한 최소 매장 생성만 먼저 구현함(`PROVISIONAL P-04`).
- **S03 내 Excel 가져오기 버튼 및 레시피 인라인 편집:** 각각 `REQ-004`/`REQ-007` 후속 작업 범위이므로 화면에서 `준비 중` 및 `미등록`으로 명확히 표시함.
- **PostgreSQL 실 컨테이너 기동 확인:** 로컬 Docker Desktop 엔진이 실행되지 않아 SQLite로 마이그레이션과 API 테스트를 검증함(`P-07`).

## 6. 실제 POS 연동 여부와 검증 범위

- **실제 POS 연동 여부:** **미연동 (`UNVERIFIED`)**
- 토스플레이스 Open API(모드 A), POS Plugin SDK(모드 B), CSV/Excel(모드 C) 모두 아직 실제 연동되지 않았으며, 백엔드 `/health`, 프론트엔드 상단 상태바, 메뉴 목록의 `POS 연결: 미연결 (연동 전)` 배지에 정직하게 표시함.

## 7. 알려진 오류, 기술 부채, TODO

- FastAPI `TestClient` 내부의 `starlette` ↔ `httpx` deprecation 경고 1건(테스트 통과에는 영향 없음).
- 카테고리 필터 드롭다운이 현재 조회된 메뉴 목록에서 카테고리를 추출하므로, 특정 카테고리로 필터링한 뒤에도 전체 카테고리 목록을 유지하려면 별도 카테고리 목록 응답 또는 전체 캐시를 참조하도록 개선 가능([[REV-20261025-001_첫번째_vertical_slice]]에 기록).
- Docker Desktop 실행 후 PostgreSQL 17 컨테이너 대상 `alembic upgrade head` 검증 필요.

## 8. UI / 아키텍처 / 기획 문서 변경 여부

- 원본 기획/아키텍처/UI 문서(DOCS 루트)는 사용자 지침(`U-02`)에 따라 수정하지 않고 그대로 보존함.
- `DOCS/05_운영/` 아래에 [[개발에이전트_작업규약]], [[개발_워크플로]], [[문서_검토_요약]], [[결정사항_로그]], [[요구사항_ID_매핑]], [[인터뷰_기록]], [[변경이력]], [[현재_인수인계]]를 신규 작성/갱신함.

## 9. 리뷰어가 확인할 테스트 방법

1. `cd c:\dev\food\backend && .\.venv\Scripts\pytest.exe -v` 실행 → 7개 테스트 통과 확인
2. `cd c:\dev\food\frontend && npm run test && npm run build` 실행 → 단위 테스트 및 빌드 통과 확인
3. 백엔드(`uvicorn app.main:app --port 8000`)와 프론트엔드(`npm run dev`)를 띄운 뒤 `http://localhost:5173`에서 매장 생성 → 메뉴 추가 → 수정 → 비활성화/재활성화 동작 확인
