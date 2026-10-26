---
id: TEST-20261025-001
type: test-record
status: DONE
created: 2026-10-25
updated: 2026-10-25
source_of_truth: false
work_order: "[[WO-20261025-001_첫번째_vertical_slice]]"
report: "[[IR-20261025-001_첫번째_vertical_slice]]"
tags: [test-record]
---

# TEST-20261025-001 — 첫 번째 vertical slice (메뉴 관리 최소 CRUD)

| ID | 상태 | 작성일 | 관련 문서 | 관련 작업 |
|---|---|---|---|---|
| TEST-20261025-001 | DONE | 2026-10-25 | [[IR-20261025-001_첫번째_vertical_slice]] | [[WO-20261025-001_첫번째_vertical_slice]] |

## 1. 실행 환경

- OS: Windows (PowerShell)
- Python: `3.12.10` (`C:\dev\food\backend\.venv`)
- Node.js / npm: `v24.12.0` / `11.13.0`
- DB (자동 테스트): SQLite in-memory (`sqlite+pysqlite:///:memory:`, `StaticPool`) — `PROVISIONAL (P-07)`
- DB (Alembic 마이그레이션 검증): SQLite 로컬 파일 (`test_migration.db`)
- Docker Desktop: CLI(`29.8.2`)는 설치되어 있으나 데몬 미실행(`npipe:////./pipe/dockerDesktopLinuxEngine` 접근 불가)으로 PostgreSQL 컨테이너 기동 테스트는 미수행

## 2. 실제 실행 명령과 결과

| # | 구분 | 실행 명령 | 결과 | 비고 |
|---|---|---|---|---|
| 1 | Alembic 마이그레이션 | `.\.venv\Scripts\alembic.exe upgrade head` | **PASS** (`0001_initial_menus` 적용) | `stores`, `menu_items`, `audit_events` 생성 확인 |
| 2 | 백엔드 Linter | `.\.venv\Scripts\ruff.exe check .` | **PASS** (`All checks passed!`) | |
| 3 | 백엔드 API/통합 테스트 | `.\.venv\Scripts\pytest.exe -v` | **PASS** (`7 passed`) | AC-1 ~ AC-8 전체 검증 |
| 4 | 프론트엔드 타입 검사 | `npm run typecheck` (`tsc --noEmit`) | **PASS** (오류 0건) | `strict: true` |
| 5 | 프론트엔드 단위 테스트 | `npm run test` (`vitest run`) | **PASS** (`5 passed`) | `menuValidation.test.ts` |
| 6 | 프론트엔드 프로덕션 빌드 | `npm run build` (`tsc -b && vite build`) | **PASS** (`dist/` 생성 완료) | |
| 7 | Vault 링크 검사 | `powershell -File DOCS\_scripts\check-links.ps1` | **PASS** (`Broken links: 0, Duplicate note names: 0`) | |

## 3. 수용 기준(AC)별 검증 매핑

- **AC-1 매장 생성·조회:** `test_ac1_store_create_and_list` — PASS
- **AC-2 메뉴 생성·목록·검색:** `test_ac2_ac3_menu_create_list_filter_and_patch` — PASS
- **AC-3 메뉴 PATCH 부분 수정:** `test_ac2_ac3_menu_create_list_filter_and_patch` — PASS
- **AC-4 비활성화 보존 및 재활성화:** `test_ac4_menu_deactivate_preserves_record_and_allows_reactivation` — PASS
- **AC-5 입력 검증 오류 422 및 필드별 details:** `test_ac5_validation_error_returns_field_details` — PASS
- **AC-6 활성 메뉴명 중복 409:** `test_ac6_duplicate_active_menu_name_returns_409` — PASS
- **AC-7 매장 간 격리(타 매장 메뉴 404):** `test_ac7_store_isolation_returns_404_for_other_store_menu` — PASS
- **AC-8 감사 로그(`audit_events`) 기록:** `test_ac8_audit_events_recorded_on_create_update_deactivate` — PASS
- **AC-9 Alembic migration 적용:** SQLite 대상 실행 PASS (PostgreSQL 대상은 Docker Desktop 실행 후 검증 필요)
- **AC-10 프론트엔드 타입·테스트·빌드:** `typecheck`, `vitest`, `vite build` 모두 PASS

## 4. 실행하지 못한 검증과 이유 (정직한 기록)

1. **PostgreSQL 17 실 컨테이너 대상 마이그레이션/쿼리 실행:** 현재 로컬에서 Docker Desktop 엔진이 꺼져 있어 `db/docker-compose.yml` 기동을 실행하지 못함.
2. **실제 브라우저 수동 클릭 확인(AC-11):** 프론트엔드 빌드와 API 통합 테스트는 완료했으나, 사용자가 직접 브라우저에서 UI 조작감을 확인하는 절차는 남아 있음.
3. **Obsidian 데스크톱 앱에서 그래프 뷰 육안 확인:** 파일 및 `[[wikilink]]` 무결성 스크립트 검사는 통과했으나, Obsidian GUI 렌더링 자체는 사용자가 앱에서 확인해야 함.
