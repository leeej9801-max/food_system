---
id: REV-20261025-001
type: review
status: DONE
result: PASS_WITH_ACTIONS
review_kind: self-review
created: 2026-10-25
updated: 2026-10-25
source_of_truth: false
report: "[[IR-20261025-001_첫번째_vertical_slice]]"
work_order: "[[WO-20261025-001_첫번째_vertical_slice]]"
follow_up: []
tags: [review]
---

# REV-20261025-001 — 첫 번째 vertical slice 리뷰 (self-review)

| ID | 상태 | 작성일 | 관련 문서 | 관련 작업 | 관련 결정 |
|---|---|---|---|---|---|
| REV-20261025-001 | DONE | 2026-10-25 | [[IR-20261025-001_첫번째_vertical_slice]], [[TEST-20261025-001_첫번째_vertical_slice]] | [[WO-20261025-001_첫번째_vertical_slice]] | P-01~P-09 |

- **리뷰 방식:** **`self-review`** (별도 독립 리뷰 에이전트/외부 리뷰어가 아닌 구현 에이전트의 자체 점검임을 명시)
- **결과:** **`PASS_WITH_ACTIONS`** (핵심 수용 기준 AC-1~AC-10 모두 충족, 블로커 없음, 경미한 개선 사항은 후속 작업에서 처리 가능)

## 1. 검토 관점 체크리스트

- [x] **요구사항 충족:** 메뉴 목록 조회, 생성, 부분 수정(PATCH), 비활성화/재활성화, DB 영속화, 프론트엔드 목록/모달 연결 완료.
- [x] **데이터 정확성:** 판매가격 `Numeric(12, 2)` 저장, 음수 가격 차단, 물리 삭제 대신 `is_active` 보존, `audit_events`에 변경 전후 스냅샷 기록 확인.
- [x] **보안:** POS 비밀키 없음, `.env` gitignore 처리, `store_id` 조건으로 타 매장 메뉴 접근 차단(404). 단, 인증(`P-05`)은 로컬 개발 단계이므로 공개 배포 전 필수 구현 필요.
- [x] **예외 상황:** 공백 메뉴명·음수 가격(422 + 필드별 오류), 활성 메뉴명 중복(409), 미존재 매장/메뉴(404), 네트워크/서버 오류 시 모달 입력값 유지 확인.
- [x] **UX:** 가짜 샘플 데이터 미표시, POS 미연결·레시피 미등록 상태 정직하게 표시, 상태 배지에 색상+텍스트/기호(`●`/`○`) 병기.
- [x] **테스트 커버리지:** 백엔드 API 7개 시나리오 + 프론트엔드 검증 유틸 5개 단위 테스트 통과.

## 2. 발견 사항

| # | 심각도 | 내용 | 재현 절차 / 근거 | 수정 권고 | 우선순위 |
|---|---|---|---|---|---|
| F-01 | `MINOR` | PATCH에서 선택 필드(`selling_price`, `category`, `description`)를 기존 값에서 `null`로 비우는 동작은 프론트 모달에서는 정상 동작하나, 백엔드 테스트에 "기존 가격을 `null`로 초기화"하는 케이스가 명시적으로 없음 | `backend/tests/api/test_menus_api.py` 확인 | 다음 메뉴/레시피 확장 WO에서 `selling_price: null` PATCH 테스트 1건 추가 | 낮음 |
| F-02 | `MINOR` | `MenuManagementPage.tsx`의 카테고리 드롭다운 목록이 현재 필터링된 결과(`menusQuery.data`)에서 추출되어, 특정 키워드 검색 중에는 다른 카테고리가 드롭다운에 보이지 않을 수 있음 | `MenuManagementPage.tsx` `categories` `useMemo` | 카테고리 목록을 전체 메뉴 캐시 또는 별도 응답에서 계산하도록 후속 개선 | 낮음 |
| F-03 | `NIT` | Docker Desktop 미실행으로 PostgreSQL 17 컨테이너 대상 `alembic upgrade head`가 아직 실행되지 않음 (SQLite에서만 실행됨) | [[TEST-20261025-001_첫번째_vertical_slice]] §4 | Docker Desktop 기동 후 `db/docker-compose.yml` 대상 마이그레이션 1회 검증 | 중간 |

## 3. 후속 조치 및 권고

- `BLOCKER`/`MAJOR` 항목이 없으므로 `WO-20261025-001`은 완료(`DONE`)로 닫는다.
- F-01, F-02는 후속 작업지시서(식자재·레시피 CRUD 또는 S00 매장/테이블 설정) 진행 시 함께 반영한다.
