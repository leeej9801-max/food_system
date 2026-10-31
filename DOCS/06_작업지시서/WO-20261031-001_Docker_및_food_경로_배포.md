---
id: WO-20261031-001
type: work-order
status: DONE
created: 2026-10-31
updated: 2026-10-31
source_of_truth: false
related:
  - "[[개발_워크플로]]"
  - "[[결정사항_로그]]"
  - "[[현재_인수인계]]"
tags: [deployment, docker, routing]
---

# WO-20261031-001 — Docker 및 /food 경로 배포

## 목적과 범위
사용자 요청: 현재 Windows PC에서 프론트·FastAPI·DB를 하나의 Compose YAML로 실행하고 기존 `lci-prod` Tunnel의 `lci.leejblab.site/food`에 연결한다. 다른 화면의 직접 URL·새로고침·컨테이너 재시작에서도 저장 데이터와 연결 관계를 유지한다.

- 관련: S00~S07, REQ-001~013의 배포 및 데이터 보존, ADR-011.
- 기존 수정 파일과 기존 lci 서비스·DB를 보존한다. POS A/B 실연동은 미검증 그대로 유지.
- 화면은 기존 경로(`/food/home`, `/food/menus` 등)를 활용하고 선택 조건은 query string으로 전달하는 안을 제안했다. 사용자 요청에 따라 합리적인 최소 구현으로 진행하며 제품 미결정 D-01~08은 변경하지 않는다.
- 비범위: 다중 매장 SaaS 권한, POS 실제 자격증명 연동, 시각 디자인 개편.

## 구현과 수용 기준
1. 프론트·백엔드 Dockerfile, Compose, Nginx, 환경변수 예시 및 실행 가이드 제공.
2. DB healthcheck → Alembic migration → API 순서 보장. 기존 데이터의 백업/이전과 영구 볼륨 검증.
3. Vite base, Router basename, 상대 API 주소를 /food에 맞추고 링크·직접 접속·새로고침 검증.
4. 매장 context를 모든 화면에서 공유하고 URL 조건을 화면 이동·새로고침에 유지.
5. 현재 Tunnel 설정을 조회한 뒤 기존 루트 서비스 규칙보다 앞에 /food 규칙을 추가. 기존 사이트를 보존.
6. 현재 인증 없음(P-05) 때문에 공개 전 접근 제한을 구성. 임시 인증 방식은 PROVISIONAL로 기록. UI가 요구하는 보안 권한 변경의 확인은 구체적인 준비가 끝난 시점에 수행.
7. 프론트 typecheck/test/build, 백엔드 lint/test, Docker 스모크, 브라우저 화면 이동, DB 재시작 보존을 실제 실행하고 결과 기록.

## 위험 및 선행 조건
- 사용자 로컬 DB가 SQLite인지 PostgreSQL인지 확인 후 보존. 기존 DB 재생성/볼륨 삭제 금지.
- 기존 코드 변경이 있는 작업 폴더에서 최소 diff로 구현.
- Tunnel/API 자격증명은 로그·문서·fixture에 기록하지 않는다.
- Windows PC 절전·인터넷·Docker 중단 시 접속 불가.

## 예상 파일 및 완료 조건
`compose.yaml`, `deploy/*`, 프론트·백엔드 Dockerfile/.dockerignore, 프론트 routing/context, 배포 가이드 및 WO/IR/REV/TEST/인수인계/허브/결정사항/변경이력.

IR·REV(self-review)·TEST 작성 및 인수인계 갱신. 실제 공개 변경 또는 외부 검증이 불가능하면 차단 이유와 남은 사용자 조작을 명시하고 완료로 과장하지 않는다.

## 범위 변경 기록 — 2026-10-31
사용자가 로그인 없는 상태에서는 링크를 아는 사람이 같은 데모 데이터를 조회·수정할 수 있다는 설명을 받은 뒤, 지인에게 소개할 프로토타입이므로 현재는 로그인을 붙이지 않아도 된다고 명시했다. 최신 사용자 지시를 우선하여 이번 데모 공개에 한해 수용 기준 6의 Access 적용을 제외한다(U-14). 실제 매장 운영/민감 데이터 사용 전 인증은 후속 과제이며 기존 LCI 보안 설정은 변경하지 않는다. 준비한 `/food` 경로를 저장·우선 배치하고 무인증 외부 화면/API 및 기존 루트를 검증한다.

## 완료 기록 — 2026-10-31
U-14에 따른 무인증 데모 공개 완료. Cloudflare /food 규칙 1순위 저장 및 reload 후 보존, 일반 브라우저 User-Agent의 쿠키 없는 HTTPS 요청으로 6화면/6API/assets smoke PASS. 실제 브라우저 메뉴·재고 데이터 표시 확인. 기존 LCI 루트 `200 / LCI-Match` 유지. [[IR-20261031-001_Docker_및_food_경로_배포]] 최종 결과 참조.
