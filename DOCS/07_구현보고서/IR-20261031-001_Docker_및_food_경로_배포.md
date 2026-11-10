---
id: IR-20261031-001
type: implementation-report
status: DONE
created: 2026-10-31
updated: 2026-10-31
source_of_truth: false
related:
  - "[[WO-20261031-001_Docker_및_food_경로_배포]]"
  - "[[TEST-20261031-001_Docker_및_food_경로_배포]]"
  - "[[REV-20261031-001_Docker_및_food_경로_배포]]"
tags: [docker, deployment, routing]
---

# IR-20261031-001 — Docker 및 /food 경로 배포

> 최종 상태(2026-10-31): U-14에 따라 로그인 없는 데모 공개 및 외부 HTTPS 검증 완료. 아래 최초 보고 시점의 대기 항목은 마지막 "외부 공개 최종 결과"로 갱신하며 이력은 보존한다.

## 결과와 범위
S00~S07 / REQ-001~013의 로컬 Docker 배포와 저장 데이터 보존 완료. 실제 외부 공개·인증 적용은 아직 완료되지 않았으므로 REVIEW 상태. POS A/B 실연동 미검증 유지.

## 파일과 동작
- `compose.yaml`: 전용 PostgreSQL 17 볼륨, DB 준비 → Alembic → FastAPI → Nginx. 웹만 기존 `lci-prod_edge`에 `food-web` 별칭으로 연결. 로컬 포트 127.0.0.1:8088. 기존 LCI DB·컨테이너·DNS는 유지.
- `backend/Dockerfile`, `.dockerignore`, `requirements.deploy.txt`, `pyproject.toml`: 명시적 앱 패키지, 개발 의존성 제외, uv.lock export 버전/해시 고정, non-root API 사용자. 기존 untracked uv.lock은 덮어쓰지 않음.
- `backend/scripts/prepare_deployment.py`, `import_sqlite.py`, `tests/test_import_sqlite.py`: 비밀 값 비표시 환경파일 생성, SQLite consistent backup, 빈 target에만 전체 transaction 이전, 실패 rollback/재실행 거부 테스트.
- `frontend/Dockerfile`, `.dockerignore`, `nginx.conf`: /food base의 정적 프론트, 하위 URL SPA fallback, API /food prefix 제거, 동적 DNS, HTML/API 캐시 금지, 정적 해시 assets 캐시.
- `App.tsx`, `AppLink.tsx`, `navigation.ts`, `useUrlState.ts` 및 관련 화면: BASE_URL basename, store query의 공통 context, 존재하지 않는 매장 오류, 메뉴/식자재 필터와 재고 선택/탭의 URL 보존. 저장 완료 데이터는 DB 사용. 원래 작업 폴더의 수정 내용 보존.
- `deploy/.env.example`, `deploy/README.md`, 루트 README: 실행, 최초 이전, 백업, 업데이트, 인증, 기존 터널 경로 추가/우선순위 안내.

## 실행 및 데이터
`C:\dev\food`에서 `docker compose --env-file .env.deploy up -d --build --wait`. `.env.deploy`는 이 PC에 생성했으며 git에서 제외. 비밀 값은 기록하지 않는다.

현재 `http://localhost:8088/food/`로 실행 중. 최초 SQLite snapshot을 16개 테이블/559행 PostgreSQL로 이전. 컨테이너 재시작 후 모든 행·필드 일치 검증 완료. 원본 `backend/local_dev.db`와 `.deploy/` backup은 유지. 이후 기존 개발 서버에 쓰면 두 DB는 자동 동기화되지 않으므로 배포 앱으로 입력을 통일해야 한다.

## 테스트
프론트 7개, 백엔드 24개 통과. lint/typecheck/build, Compose config/image/healthcheck, 모든 필드 이전 일치, DB 재시작 보존, 6화면/6API HTTP 및 브라우저 URL/필터 복원 통과. 자세한 실행 결과/초기 실패/미검증은 [[TEST-20261031-001_Docker_및_food_경로_배포]].

## 남은 배포 단계
- 준비된 Cloudflare 경로 초안: `lci.leejblab.site`, regex `^/food(/.*)?$`, service `http://food-web:80`. 아직 저장하지 않음. 기존 전체 호스트 규칙보다 먼저 매칭되게 순서 설정 필요.
- P-05/ADR-011: 외부 공개 전 정확한 이메일 Allow의 Cloudflare Access로 `/food`와 모든 하위 API를 보호해야 함. 방식 제안은 PROVISIONAL P-14. 외부 공개/권한 변경은 브라우저 도구 규칙상 적용 직전 사용자 확인 대상.
- 공개 후 기존 루트 사이트/무인증 차단/인증 사용자 접속·API를 실제 검증해야 완료.
- PC 재부팅 자동 복구, 부하 테스트, 다중 매장 권한, POS A/B는 검증/구현 범위 밖.

## 외부 공개 최종 결과 — 2026-10-31
- 사용자는 무인증 공유 시 다른 사람이 같은 데이터를 조회·수정할 수 있다는 설명을 받은 뒤 지인 소개용 프로토타입에는 로그인이 필요 없다고 명시(U-14). 이전 Access 제안/승인 대기를 대체했으며 Access 애플리케이션은 생성하지 않았다.
- `lci-prod`에 호스트 `lci.leejblab.site`, regex `^/food(/.*)?$`, 서비스 `http://food-web:80`를 저장하고 1순위로 배치. 기존 전체 경로 `http://nginx:80`는 2순위로 유지. 대시보드 reload 후 순서 저장 확인.
- 공개 URL: `https://lci.leejblab.site/food/`. 표준 브라우저 User-Agent로 쿠키 없이 6화면/6API/assets/no-store/없는 asset 404 검사 PASS. 실제 ego-lite 공개 도메인에서 메뉴·매출·재고와 store/query URL 동작 확인.
- 기존 루트는 변경 전후 `200`, title `LCI-Match`. 기존 LCI 서비스·보안 설정 변경 없이 유지.
- 최초 Python 기본 User-Agent 요청은 Cloudflare 1010/403(원본 도달 전)으로 차단. 기존 Cloudflare 보호 설정을 약화하지 않고 브라우저 및 일반 User-Agent의 무인증 요청으로 검증했다.
- 변경 이후 비즈니스 코드 수정/DB 삭제/재시드 없음. 로컬 단계의 24+7 테스트와 16테이블559행 전체 필드/재시작 보존 검증 결과 유지.
- 문서: 공개 데모 결정·인터뷰·WO/IR/REV/TEST/배포 안내/허브/인수인계/변경이력 갱신. 실운영 인증·기기별 부하·PC 재부팅·별도 모바일 회선 테스트는 미검증/후속.
