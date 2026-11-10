---
id: TEST-20261031-001
type: test-record
status: DONE
created: 2026-10-31
updated: 2026-10-31
source_of_truth: false
related:
  - "[[WO-20261031-001_Docker_및_food_경로_배포]]"
  - "[[IR-20261031-001_Docker_및_food_경로_배포]]"
tags: [test, docker, deployment]
---

# TEST-20261031-001 — Docker 및 /food 경로 배포

## 실제 실행 결과
| 검사 | 결과 |
|---|---|
| 프론트 `npm run typecheck` | PASS |
| `npm run test` | 2 files / 7 tests PASS (기존 5 + navigation 2) |
| `npm run build -- --base=/food/` | PASS |
| 백엔드 `.venv/Scripts/ruff.exe check .` | PASS (초기 새 파일 린트 2건 수정 후 재검사) |
| `.venv/Scripts/python.exe -m pytest -q -o faulthandler_timeout=30` | 24 passed, 1 warning, 52.60s |
| `npm audit --omit=dev --json` | 운영 의존성 vulnerabilities 0 |
| `docker compose --env-file .env.deploy config --quiet` | PASS |
| 프론트/백엔드 이미지 build | PASS. 백엔드는 uv.lock에서 export한 버전/해시로 최종 재빌드 |
| PostgreSQL 17 및 Alembic | 정상 생성, migration exit 0 |
| SQLite → PostgreSQL | 전체 16개 업무 테이블, 559행 이전. UUID/관계/이력 유지 |
| 백업↔PostgreSQL 비교 | 모든 테이블의 모든 행/필드 일치 (naive UTC만 UTC tz 부여 후 비교) |
| HTTP smoke | 6개 화면 direct URL 200, HTML asset 200, 6개 API 연결, API/HTML no-store, 없는 asset 404 |
| food DB/API/web restart | 세 서비스 healthy 복구. HTTP smoke 재통과 및 559행 전체 필드 일치 |
| ego-lite 브라우저 | 기존 메뉴/매출/테이블 데이터 표시, 검색 `q`가 URL에 반영되고 reload 복원. 메뉴 링크에서 재고로 이동 시 store 유지. `history.back()`으로 검색 URL 복원 |
| 기존 LCI | 원래 컨테이너들 Up 7 hours healthy 유지, 기존 터널 전체 호스트 → `http://nginx:80` 변경 없음 |
| 문서 링크 | 최종 59 files, 579 links, broken 0 / duplicate 0 |
| `git diff --check` | PASS |

## 환경 문제와 실제 검증 범위
- 최초 sandbox 안 API 테스트는 Windows asyncio socketpair 생성에서 정지. faulthandler로 `socket.accept`/`_fallback_socketpair` 대기 확인. 해당 테스트 프로세스를 정리하고 sandbox 밖 실제 환경에서 전체 24개 통과. 앱 코드를 우회 수정하지 않음.
- 최초 npm audit는 sandbox DNS ENOTFOUND. 실제 네트워크 환경에서 재실행해 운영 의존성 0건 확인. 빌드 단계의 개발 의존성 경고는 별도 업그레이드하지 않음(정적 파일만 Nginx 이미지에 복사).
- ego-lite 최소화 중 조작/캡처 실패. 사용자 창 복원 후 입력/클릭/스크린샷 정상. 단축키 방식 뒤로 가기는 자동화에서 동작하지 않아 Page 내 `history.back()`으로 실제 popstate/URL 복원을 확인.
- 실제 데이터 쓰기 테스트는 격리된 자동 테스트에서 수행. 이전된 사용자 업무 데이터에는 추가/수정/삭제 테스트를 하지 않음.
- 외부 `/food` 연결, Cloudflare Access 인증/차단, 외부 기기 접속, PC 재부팅 복구 및 부하 테스트는 아직 미검증. POS A/B 미검증 유지.

## 후속 외부 검증 — 2026-10-31 (상단 최초 대기 항목 갱신)
- U-14: 지인 소개용 공개 데모의 로그인 생략을 사용자 승인. Access 인증/차단 테스트는 이번 수용 범위에서 제외.
- Cloudflare /food route 저장 성공. 1순위 `/food`→`http://food-web:80`, 2순위 기존 전체 호스트→`http://nginx:80`. reload 후 저장 상태 확인.
- `python .deploy/smoke.py https://lci.leejblab.site/food`: **PASS**. 일반 User-Agent, 인증 헤더/쿠키 없이 6개 화면, 정적 assets, 6개 API, cache/no-store 및 없는 asset 404 검증.
- ego-lite 실제 공개 도메인: 메뉴·매출·테이블 기존 데이터 표시, `/food/inventory?...&tab=COUNT` 직접 접속 후 재고 데이터 로딩 확인. 기존 로컬 URL/query/reload/history 테스트와 결합 검증.
- 기존 LCI 루트: HTTPS 200 / title `LCI-Match`, 변경 전후 동일.
- 첫 Python 기본 User-Agent 외부 요청은 Cloudflare 1010/403으로 차단. 보호 설정은 변경하지 않았으며 일반 브라우저 및 표준 User-Agent 무인증 요청은 PASS.
- 실제 모바일 별도 회선, PC 재부팅 및 부하 테스트는 하지 않았다. POS A/B 미검증 유지. 사용자 원본 데이터 변경 테스트는 하지 않음.
- 공유 기본 주소 `/food` → `/food/` HTTPS200 리다이렉트 정상. 실제 브라우저에서 같은 매장의 `/food/home?store=...`로 진입하고 기존 홀 5/6테이블·방문15팀·순매출 데이터 표시 확인. 문서 최종 링크 579개 broken0, `git diff --check` PASS.
