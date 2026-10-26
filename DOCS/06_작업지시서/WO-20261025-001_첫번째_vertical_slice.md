---
id: WO-20261025-001
type: work-order
status: DONE
created: 2026-10-25
updated: 2026-10-25
source_of_truth: false
related_req: [REQ-005, REQ-001, REQ-013]
related_screens: [S03, S00]
related_decisions: [ADR-001, ADR-002, ADR-003, ADR-010, U-03, U-04, U-05, P-01, P-02, P-03, P-04, P-05, P-06, P-07, P-08, P-09]
related:
  - "[[음식점_AX_통합기획서_v1.0]]"
  - "[[음식점_AX_기술아키텍처_선정및구조_v1.0]]"
  - "[[음식점_AX_UI명세서_v0.1]]"
  - "[[결정사항_로그]]"
report: "[[IR-20261025-001_첫번째_vertical_slice]]"
review: "[[REV-20261025-001_첫번째_vertical_slice]]"
tags: [work-order]
---

# WO-20261025-001 — 첫 번째 vertical slice: 프로젝트 골격 + 메뉴 관리 최소 CRUD

| ID | 상태 | 작성일 | 관련 문서 | 관련 작업 | 관련 결정 |
|---|---|---|---|---|---|
| WO-20261025-001 | DONE | 2026-10-25 | [[음식점_AX_통합기획서_v1.0]] §4.1 #5, [[음식점_AX_UI명세서_v0.1]] S03, [[음식점_AX_기술아키텍처_선정및구조_v1.0]] §4·§5·§7 | 선행 없음 / 후속: 리뷰 결과에 따름 | ADR-001~003, ADR-010, P-01~P-09 |

## 1. 목적 / 문제

저장소가 비어 있다([[문서_검토_요약#4. 저장소 관찰 (2026-10-25 조사 시점)]]). 아키텍처 Phase 1의 **가장 작은 실행 가능한 골격**(FastAPI + SQLAlchemy/Alembic + PostgreSQL compose, React+TS+Vite)을 만들고, 그 위에 시작 명령 §5-3의 권장 첫 slice인 **메뉴 관리 최소 CRUD**(REQ-005, S03)를 end-to-end로 연결한다. 메뉴는 `store_id` 범위가 필요하므로(ADR-010) 매장 최소 생성(REQ-001 일부, P-04)을 선행한다.

## 2. 범위

### 포함
- `backend/`: FastAPI 앱, 설정(.env), DB 세션, 모델 `stores`·`menu_items`·`audit_events`, Alembic 초기 migration, API `/api/v1`
  - `GET/POST /api/v1/stores`, `GET /api/v1/stores/{store_id}`
  - `GET /api/v1/stores/{store_id}/menus` (검색 `q`, `category`, `status=active|inactive|all`)
  - `POST /api/v1/stores/{store_id}/menus`, `GET/PATCH /api/v1/stores/{store_id}/menus/{menu_id}`
  - 활성/비활성은 `PATCH { "is_active": bool }` (물리 삭제 없음, P-06)
  - 일관된 오류 응답 `{ "error": { "code", "message", "details": [{ "field", "message" }] } }`
  - 메뉴 생성/수정/활성 변경 시 `audit_events`에 before/after 요약 기록(REQ-013 최소)
- `db/`: PostgreSQL 17 Docker Compose (U-04)
- `frontend/`: Vite React TS, React Router, TanStack Query, Tailwind
  - 레이아웃(왼쪽 내비게이션: 홈/메뉴 관리/식자재·레시피/입고·재고/분석/설정 — 미구현 화면은 "준비 중")
  - 매장이 없으면 최소 매장 생성 폼(P-04)
  - S03 메뉴 관리: 목록(메뉴명·가격·카테고리·상태·POS 연결·레시피·관리), 검색·카테고리·상태 필터, 추가/수정 모달, 활성/비활성 전환, 저장 중/성공/실패 표시, 실패 시 입력 보존, 필드별 서버 오류 표시
- 테스트: backend pytest(API + 검증 + 오류 + 감사 로그), frontend vitest(입력 검증 유틸) + `tsc`/build
- 루트: `AGENTS.md`, `README.md`, `.gitignore`, `backend/.env.example`

### 제외 (비범위)
- POS 연동(A/B), POS 상품 매핑, CSV import, 레시피·식자재, S00 전체 마법사, 테이블 배치, 인증(P-05), PWA, shadcn/ui(P-08), worker, Docker 이미지화(api/frontend)

## 3. 관련 요구사항·화면·결정
- REQ: REQ-005(주), REQ-001(일부), REQ-013(일부) — [[요구사항_ID_매핑]]
- 화면: S03(주), S00(최소)
- 결정: ADR-001/002/003/010, U-03/U-04/U-05, P-01~P-09 — [[결정사항_로그]]

## 4. 선행 조건
- Python 3.12 (설치 완료, U-03), Node 24 / npm 11 (있음)
- 패키지 설치를 위한 네트워크 접근(pip/npm)
- PostgreSQL 실행은 Docker Desktop 필요 — 자동 테스트는 SQLite로 대체 가능(P-07)

## 5. 구현 요구사항
1. 메뉴 필드: `name`(필수, 1~100자, 앞뒤 공백 제거), `selling_price`(선택, 0 이상, 최대 99,999,999, 소수 2자리까지), `category`(선택, ≤50자), `description`(선택, ≤500자), `is_active`(기본 true). 
2. 같은 매장의 활성 메뉴 중 이름(trim·casefold) 중복 시 `409 DUPLICATE_MENU_NAME` (P-01).
3. 존재하지 않는 매장/메뉴, 다른 매장의 메뉴 접근은 `404` (store 범위 격리).
4. 금액 `Numeric(12,2)`, 시각 timezone-aware UTC.
5. 목록은 활성 우선 + 이름순, `status` 기본값 `all`.
6. 프론트는 서버 결과를 표시하며 계산을 독점하지 않는다. "POS 연결: 미연결(연동 전)", "레시피: 미등록"으로 정직하게 표시(P-09).

## 6. 수용 기준 (검증 가능)
- [x] AC-1 매장을 생성하고 조회할 수 있다(API 테스트).
- [x] AC-2 메뉴를 생성하면 DB에 저장되고 목록 API에 나타난다(API 테스트).
- [x] AC-3 메뉴 수정(PATCH) 시 변경 필드만 반영된다(API 테스트).
- [x] AC-4 비활성화한 메뉴는 삭제되지 않고 `status=inactive`로 조회되며, 재활성화 가능하다(API 테스트).
- [x] AC-5 빈 이름·음수 가격·과도한 길이는 422 + 필드별 `details`를 반환한다(API 테스트).
- [x] AC-6 활성 메뉴명 중복은 409를 반환한다(API 테스트).
- [x] AC-7 다른 매장의 메뉴를 조회/수정하면 404(API 테스트).
- [x] AC-8 생성/수정/비활성화가 `audit_events`에 기록된다(API 테스트).
- [x] AC-9 Alembic migration이 빈 DB에 적용된다(SQLite로 실행 확인, PostgreSQL은 Docker 가능 시).
- [x] AC-10 프론트엔드 타입 검사·빌드·단위 테스트가 통과한다.
- [ ] AC-11 브라우저에서 매장 생성 → 메뉴 추가/수정/비활성화가 동작한다(수동 확인은 사용자 브라우저에서 수행하도록 IR에 정직하게 기록).

## 7. 테스트 계획
- `backend`: `pytest -q` (SQLite 인메모리, StaticPool), `alembic upgrade head` (SQLite 파일)
- `frontend`: `npm run typecheck`, `npm run test`, `npm run build`
- E2E 스모크: 백엔드 실행 + HTTP 호출로 API 흐름 확인. 브라우저 수동 확인은 사용자에게 안내.

## 8. 위험 / 미결정 / PROVISIONAL
- P-01~P-09 전부 PROVISIONAL. 특히 P-03(카테고리 마스터)과 P-01(중복 정책)은 리뷰 후 사용자 인터뷰 후보.
- SQLite 테스트는 PostgreSQL 고유 동작(대소문자 정렬, numeric)을 완전히 대변하지 못함(P-07).
- 인증 없음 → 로컬 전용(P-05).

## 9. 예상 수정 파일
- 신규: `AGENTS.md`, `README.md`, `.gitignore`, `db/docker-compose.yml`, `backend/**`, `frontend/**`
- 문서: 이 WO, IR/REV/TEST-20261025-001, [[현재_인수인계]], [[변경이력]], [[요구사항_ID_매핑]]

## 10. 완료 조건
AC-1~AC-10 통과(실제 실행 결과 기록), AC-11은 실행 여부를 명시, IR·REV·TEST 작성, 인수인계 갱신.

## 범위 변경 기록
| 날짜 | 변경 | 이유 |
|---|---|---|
| 2026-10-25 | 매장 최소 생성(REQ-001 일부) 포함 | 메뉴의 store_id 선행 필요(ADR-010) |
| 2026-10-25 | `audit_events` 최소 구현 포함 | REQ-013, 메뉴 수정 이력 추적 |
