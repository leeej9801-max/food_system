---
id: REV-20261031-001
type: review
status: DONE
created: 2026-10-31
updated: 2026-10-31
source_of_truth: false
related:
  - "[[IR-20261031-001_Docker_및_food_경로_배포]]"
  - "[[TEST-20261031-001_Docker_및_food_경로_배포]]"
tags: [review, self-review, deployment]
---

# REV-20261031-001 — Docker 및 /food 경로 배포

**self-review — PASS_WITH_ACTIONS** (독립 리뷰 아님).

## 검토 결과
- 로컬 배포: PASS. 실제 PostgreSQL/Alembic/Nginx/API healthcheck 및 컨테이너 restart 복구 확인.
- 데이터 보존: PASS. 원본 읽기 전용 백업, 16테이블 559행 모든 값 일치, UUID/FK/수치/이력 유지. 빈 target 가드 및 rollback 테스트.
- 라우팅: PASS(로컬). BASE_URL basename과 /food API proxy 일치. store query가 모든 링크에 유지되며 잘못된 매장에 조용히 fallback하지 않음. 검색 query reload/history 복원 확인.
- 기존 서비스: PASS. 기존 lci 컨테이너 uptime/health 유지, DB/루트 경로 변경 없음.
- 보안: 로컬 포트만 공개, DB/API는 internal망, secrets/backup git 및 이미지 제외. 운영 npm 의존성 audit 0. 실제 공개는 아래 조치 전 미완료.

## 남은 조치
1. **BLOCKER — 외부 공개 전 인증:** Cloudflare Access의 정확한 이메일 Allow 및 `/food`+하위 모든 경로 보호를 적용·검증해야 한다. 현재 앱 자체 인증 없음(P-05). 공개 경로 저장/접근 권한 변경 직전 사용자 확인 필요. 현재 route 초안만 작성해 외부에 공개하지 않음.
2. **MAJOR — 외부 E2E:** route 추가 및 기존 전체 호스트 규칙보다 앞에 배치한 뒤 기존 lci 루트, 무인증 요청 차단, 허용된 사용자 접속, API 요청을 실제 검증해야 완료.
3. **MINOR — 운영 전환:** 이후 입력은 PostgreSQL 배포 앱으로 통일. 예전 SQLite 개발 서버와 동시 입력하면 자동 병합되지 않음. PC 재부팅/절전/회선 복구는 실기 검증 필요.

동일 WO의 배포 단계에서 계속 진행하며 사용자 확인/검증 결과를 IR·TEST에 추가 기록한다. 검증되지 않은 항목을 PASS로 승격하지 않는다.

## 후속 self-review — 2026-10-31, PASS (공개 데모 범위)
이전 PASS_WITH_ACTIONS의 이력은 유지하며 최종 상태를 갱신한다.

1. 인증 BLOCKER: 사용자가 무인증 공동 조회·수정 가능성을 설명받은 뒤 프로토타입 소개용 로그인 생략을 명시(U-14). 최신 사용자 지시에 따라 이번 데모에 한해 Access 요구를 제외. 기존 LCI 보안은 유지. 실운영 인증 후속 과제는 유지.
2. 외부 E2E: /food route 1순위 및 저장/reload 확인, 표준 User-Agent 무인증 HTTPS의 6화면/6API/assets smoke PASS, 실제 공개 브라우저 데이터 표시 PASS. 기존 루트 200/LCI-Match 유지.
3. 운영 전환: SQLite 원본/백업 유지, 입력은 PostgreSQL 배포 앱으로 통일하도록 안내. 재부팅/부하/별도 모바일 회선은 미검증으로 기록.

원래 요청한 Docker·하위 URL·데이터 보존·기존 터널 외부 공개는 완료. 로그인 없는 공유 데모이며 링크를 아는 사람은 공통 데이터를 변경할 수 있다.
