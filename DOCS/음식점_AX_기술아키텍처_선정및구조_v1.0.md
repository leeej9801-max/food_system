# 음식점 AX 서비스 — 기술 아키텍처 선정 및 구조

- 문서 버전: **v1.0**
- 작성 기준일: **2026-10-25**
- 문서 상태: **권장 스택 선정 / POS 연동·배포 환경 일부 검증 필요**
- 프로젝트: 1~2인 운영 음식점 데이터 수집·운영 최적화 서비스
- 대상: 개발자, AI 코딩 에이전트, 기술 검토 참여자
- 상위 기획: `음식점_AX_통합기획서_v1.0.md`
- UI 상세: `음식점_AX_UI명세서_v0.1.md` 및 이후 최신 버전
- 작업 규약: `AGENTS.md`

> 이 문서는 개발 시작을 위한 기술 선택 및 시스템 구조 기준이다. 이 문서에서 `선정`이라고 표시된 항목은 현재 MVP의 권장 기본값이다. POS 공급업체가 실제로 제공하는 데이터·권한·설치 조건, 배포 플랫폼의 지원 버전처럼 외부 확인이 필요한 항목은 `검증 필요`로 표시한다. 검증되지 않은 연동을 구현 완료 상태로 표현하지 않는다.

---

## 1. 요약 및 아키텍처 결정

### 1.1 서비스 정의

1~2인 운영 음식점에서 POS·CSV/Excel·간편 현장 기록을 통해 운영 데이터를 수집하고, 데이터를 공통 형식으로 정리해 판매량·레시피·식자재·재고·메뉴 원가 분석으로 연결하는 웹 기반 데이터 파이프라인 서비스다.

### 1.2 선택 스택 요약

| 영역 | 기본 선택 | 결정 상태 | 이유 |
|---|---|---|---|
| 프론트엔드 | React + TypeScript + Vite | 선정 | 사용자의 기존 React/JavaScript 경험을 활용하고 앱형 화면을 빠르게 개발 |
| 화면 라우팅 | React Router | 선정 | HOME, 설정, 메뉴, 식자재, 재고, 분석 화면을 분리 |
| 서버 상태/캐시 | TanStack Query | 선정 | API 데이터 조회·캐시·갱신 상태를 일관되게 관리 |
| 스타일/UI | Tailwind CSS + shadcn/ui | 권장 선정 | 반응형 관리 화면과 반복 입력 폼을 효율적으로 구성 |
| 차트 | Recharts 또는 유사한 React 차트 라이브러리 | 잠정 | 기본 매출·재고 차트에 충분하며, 시각화 요구 확정 후 적용 |
| PWA | `vite-plugin-pwa` | 2단계 적용 | 태블릿 홈 화면 설치와 앱형 실행 지원. 오프라인 쓰기 기능은 별도 설계 |
| 백엔드 | Python + FastAPI | 선정 | REST API, 데이터 검증, POS 어댑터, 계산 로직을 한곳에서 관리 |
| 요청/응답 스키마 | Pydantic v2 | 선정 | API 입력값 검증과 응답 형식 정의 |
| ORM | SQLAlchemy 2.x | 선정 | 관계형 데이터 모델과 DB 트랜잭션 관리 |
| DB 마이그레이션 | Alembic | 선정 | 운영 중 테이블·제약조건 변경을 버전으로 관리 |
| 데이터베이스 | PostgreSQL 18.x, 호스팅에서 미지원 시 지원 중인 PostgreSQL 17.x | 선정/배포 검증 | 관계형 데이터, 외래 키, 고유 제약, 트랜잭션을 사용해 중복 수집과 재고 계산 오류 방지 |
| 데이터 수집 방식 | Adapter 인터페이스 + A/B/C 어댑터 | 선정 | POS 연동 모드가 달라도 내부 데이터 모델은 공통 유지 |
| 이벤트 수신·재처리 | PostgreSQL 기반 이벤트 저장 테이블, 동일 코드베이스의 worker | 권장 선정 | 첫 단계에서 Redis·별도 메시지 브로커 없이 이벤트 영속화·재처리 지원 |
| 실시간 화면 갱신 | 초기 REST polling, 필요 시 SSE 검토 | 선정 | 첫 매장에는 WebSocket보다 구현·디버깅이 단순함 |
| 배포 | Docker Compose로 로컬 개발, 이후 HTTPS 지원 컨테이너/호스팅 + 관리형 PostgreSQL 검토 | 잠정 | 환경 차이를 줄이며, 클라우드 공급업체 선택은 POS·예산·보안 요건 확인 후 결정 |
| 인증/비밀정보 | 공개 배포 전 인증 필수, POS 비밀키는 백엔드에서만 보관 | 기본 원칙 확정 / 상세 방식 미결정 | 매장 데이터와 POS 자격 증명 보호 |
| AI/LLM | 계산 핵심부에 사용하지 않음 | 확정 | 판매량·원가·재고는 결정론적 코드로 계산. 문서 추출·품목 후보 추천 등은 후속 기능 |

### 1.3 아키텍처 스타일

**모듈형 모놀리스(Modular Monolith) + 별도 worker 프로세스**로 시작한다.

- 프론트엔드는 별도 웹 앱으로 빌드한다.
- FastAPI 백엔드는 하나의 코드베이스를 업무 모듈로 분리한다.
- 이벤트/파일 재처리를 위한 worker는 같은 백엔드 코드베이스를 별도 프로세스로 실행할 수 있다.
- PostgreSQL을 공통 영속 저장소로 사용한다.
- POS A/B/C별 구현은 adapter로 분리하지만, 매장·메뉴·주문·식자재·재고의 내부 모델은 공유한다.
- 초기에는 마이크로서비스, Kubernetes, Redis, Kafka 등을 도입하지 않는다. 실제 필요와 관측 결과가 생긴 후 판단한다.

---

## 2. 제품 및 기술의 핵심 원칙

1. **한 사실, 한 번 기록:** POS 주문을 태블릿에서 다시 입력하지 않는다. 현장 입력은 POS에서 얻을 수 없는 정보만 대상으로 한다.
2. **원본·정규화 데이터·계산 결과 분리:** 원본 이벤트를 보존하고, 이를 표준 데이터로 변환한 뒤 판매량·원가·재고를 계산한다.
3. **수집 모드와 비즈니스 로직 분리:** Open API, Plugin SDK, CSV/Excel은 데이터를 가져오는 방법만 바꾼다.
4. **실측·수기·계산·추정의 출처 표시:** 사용자에게 실제 데이터와 추정 결과를 혼동시키지 않는다.
5. **중복에 안전한 처리:** 웹훅 재전송, 파일 재업로드, API 재조회가 중복 주문이나 재고 증감을 만들지 않도록 한다.
6. **시간 기준 명확화:** 주문 생성 시각, 메뉴 추가 시각, 결제 시각, 이벤트 수신 시각을 구분한다.
7. **계산은 코드로:** 레시피 소요량, 판매 집계, 구매 단가, 재고 수지는 LLM이 아니라 검증 가능한 함수/SQL로 계산한다.
8. **부분 데이터 허용:** 레시피 미등록이나 방문 인원 미기록 때문에 판매 데이터 수집 전체가 중단되지 않게 한다.
9. **초기에는 정확도와 사용성을 측정:** 고급 예측 모델보다 누락·중복·수기 입력 시간·계산값의 신뢰성을 먼저 측정한다.
10. **검증 전 연결 상태를 과장하지 않는다:** API 권한, Plugin 설치, 외부 네트워크, 실제 이벤트 필드는 단계별 검증 상태를 표시한다.

---

## 3. 논리 아키텍처

### 3.1 전체 흐름

```mermaid
flowchart TB
    subgraph SOURCES[데이터 원천]
      A[Toss Open API / Webhook]
      B[Toss POS Plugin SDK]
      C[CSV / Excel 업로드]
      D[태블릿 PWA 현장 입력]
    end

    subgraph INGEST[수집 계층]
      AA[Open API Adapter]
      BB[Plugin Event Receiver]
      CC[File Import Adapter]
      DD[Manual Event API]
    end

    subgraph BACKEND[FastAPI 모듈형 백엔드]
      E[원본 이벤트·Import Batch 저장]
      F[정규화 / 매핑 / 중복 방지]
      G[업무 서비스]
      G1[매장·테이블]
      G2[메뉴·레시피·식자재]
      G3[주문·판매 집계]
      G4[입고·재고·원가]
      G5[데이터 품질·동기화]
    end

    DB[(PostgreSQL)]
    UI[React PWA]
    W[동일 코드베이스 Worker]

    A --> AA
    B --> BB
    C --> CC
    D --> DD
    AA --> E
    BB --> E
    CC --> E
    DD --> G1
    E --> F
    F --> DB
    F --> W
    W --> F
    DB <--> G
    G1 --> DB
    G2 --> DB
    G3 --> DB
    G4 --> DB
    G5 --> DB
    UI <--> G
```

### 3.2 컴포넌트 책임

| 컴포넌트 | 책임 | 하지 말아야 할 일 |
|---|---|---|
| React PWA | 데이터 표시, 설정/현장 입력, 검증 오류 제시 | POS 비밀키 보관, 판매·재고 계산의 유일한 원천 역할 |
| FastAPI API | 인증, 요청 검증, 업무 서비스 호출, 표준 응답 제공 | POS별 데이터 형식을 화면마다 직접 다루기 |
| POS Adapter | 각 POS/파일의 원천 데이터를 내부 공통 형태로 변환 | 별도 POS 모드마다 중복된 메뉴·재고 기능 구현 |
| Ingestion/Event Store | 원본 이벤트와 수집 상태·오류를 보존 | 수집 실패 원본을 아무 흔적 없이 버리기 |
| Worker | 재시도 가능한 정규화·재처리·정기 동기화 | 화면 응답 요청에 장시간 작업을 묶어 두기 |
| PostgreSQL | 영속 데이터, 제약조건, 트랜잭션, 수집 이력 | 재생성 가능한 집계를 원본처럼 취급하기 |
| Calculation Services | 판매량·레시피 소비량·예상 재고·원가 시나리오 계산 | 모델/LLM 답변을 검증 없이 수치로 저장하기 |

---

## 4. 프론트엔드 구조

### 4.1 선택 기술

| 기술 | 적용 방식 |
|---|---|
| React + TypeScript | UI 및 화면 로직. `strict` 타입 검사를 활성화 |
| Vite | 개발 서버와 프로덕션 빌드 |
| React Router | 화면 이동과 URL 관리 |
| TanStack Query | API의 서버 상태, 캐시, 재조회/갱신 관리 |
| Tailwind CSS | 레이아웃·반응형 스타일 |
| shadcn/ui | 대화상자, 버튼, 입력, 탭, 드롭다운 등 기본 UI |
| React Hook Form + Zod | 복잡한 입력 양식에서만 도입. 간단한 폼까지 과도하게 추상화하지 않음 |
| Recharts 등 | 데이터 분석 차트. 실제 KPI가 확정된 후 사용 |
| vite-plugin-pwa | 기본 웹 앱 안정화 후 manifest/service worker 구성 |

### 4.2 화면과 라우트

화면 ID는 UI 명세서와 일치시킨다.

| 화면 ID | 기본 경로 예시 | 역할 |
|---|---|---|
| S00 | `/setup` | 매장 등록·초기 설정 |
| S01 | `/settings/pos` | POS 연결 방식/상태/파일 가져오기 |
| S02 | `/` 또는 `/home` | 도트 스타일 테이블 배치도, 상태, 빠른 입력 |
| S03 | `/menus` | 메뉴 목록 및 등록/수정 |
| S04 | `/ingredients` 및 `/recipes` | 식자재 목록과 메뉴 레시피 연결 |
| S05 | `/inventory` | 입고, 실재고, 예상 재고, 구매가격 이력 |
| S06 | `/analytics` | 시간대별 판매량, 원가, 재고 분석 |
| S07 | `/settings` | 매장 정보, 테이블 배치, 환경 설정 |

라우트는 제안이며, UI 명세서의 후속 결정에 따라 조정할 수 있다. 메뉴와 식자재 화면을 별도 라우트로 유지할지 하위 탭으로 묶을지는 UX 인터뷰 후 결정한다.

### 4.3 프론트엔드 폴더 구조

```text
frontend/
├── public/
│   ├── icons/
│   └── manifest assets (필요 시)
├── src/
│   ├── app/
│   │   ├── router.tsx
│   │   ├── providers.tsx
│   │   └── App.tsx
│   ├── pages/
│   │   ├── StoreSetupPage.tsx
│   │   ├── PosConnectionPage.tsx
│   │   ├── HomePage.tsx
│   │   ├── MenuManagementPage.tsx
│   │   ├── IngredientManagementPage.tsx
│   │   ├── InventoryPage.tsx
│   │   ├── AnalyticsPage.tsx
│   │   └── SettingsPage.tsx
│   ├── components/
│   │   ├── layout/
│   │   ├── floor-plan/
│   │   ├── tables/
│   │   ├── forms/
│   │   └── ui/
│   ├── features/
│   │   ├── store/
│   │   ├── pos/
│   │   ├── visits/
│   │   ├── menus/
│   │   ├── recipes/
│   │   ├── ingredients/
│   │   ├── inventory/
│   │   └── analytics/
│   ├── api/
│   │   ├── client.ts
│   │   ├── stores.ts
│   │   ├── pos.ts
│   │   ├── menus.ts
│   │   ├── inventory.ts
│   │   └── analytics.ts
│   ├── types/
│   ├── hooks/
│   ├── lib/
│   └── main.tsx
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### 4.4 프론트엔드 구현 규칙

- API 주소는 코드에 직접 박아 넣지 않고 환경변수(예: `VITE_API_BASE_URL`)로 관리한다. 이 값은 공개되어도 되는 API URL만 담으며 비밀키를 넣지 않는다.
- POS API 키·토큰은 `VITE_` 변수나 브라우저 코드에 절대 넣지 않는다.
- 서버 데이터는 TanStack Query, 현재 폼 입력·모달 열림 여부·선택 테이블 등 일시적인 UI 상태는 React state로 관리한다. 초기부터 Redux를 추가하지 않는다.
- 모든 저장 요청은 진행/성공/실패 상태를 표시하고, 실패 시 사용자가 입력한 내용을 잃지 않도록 한다.
- 테이블 배치도는 초기에는 CSS/SVG 기반의 단순한 좌표·그리드 편집으로 구현한다. 별도 캔버스 엔진은 복잡한 요구가 확인될 때 검토한다.
- 색상만으로 테이블 상태를 구분하지 않고 라벨/아이콘을 같이 표시한다.
- 태블릿 터치 영역은 충분히 크게 하고, 숫자 입력에 빠른 증감 버튼과 기본값을 제공한다.
- 프론트엔드에서 재고·원가의 최종 계산을 독점하지 않는다. 서버 계산 결과를 표시한다.
- FastAPI OpenAPI 명세가 안정화되면 TypeScript API 타입 자동 생성 도구를 도입해 요청/응답 타입 불일치를 줄인다. 초기에 자동 생성 파이프라인이 개발 진행을 방해한다면 수동 타입으로 시작하되, API 변경 시 동기화한다.

### 4.5 PWA 정책

1차에서는 반응형 웹을 먼저 완성하고, PWA 설치 기능을 적용한다. 서비스 워커가 존재한다고 모든 API 데이터가 자동으로 오프라인 저장되는 것은 아니다.

- 초기 캐시 대상은 앱 정적 파일과 안전하게 캐시할 리소스로 제한한다.
- 인증 정보·POS 응답·개인 매장 데이터는 기본적으로 서비스 워커 캐시에 저장하지 않는다.
- 오프라인 현장 기록이 필요하다고 검증되면 IndexedDB 기반 outbox(미전송 기록)를 도입한다.
- 미전송 기록에는 고유 `client_event_id`, 생성 시각, 동기화 상태를 둔다.
- 재연결 시 서버가 멱등 처리하도록 하며, 동기화 성공/실패를 사용자에게 표시한다.
- API 요청과 화면 표시에서 `last_synced_at` 및 연결 상태를 분리한다.

---

## 5. 백엔드 구조

### 5.1 선택 기술

| 기술 | 역할 | 결정 |
|---|---|---|
| Python | 백엔드 구현 언어 | 선정 |
| FastAPI | REST API, 웹훅 수신, OpenAPI 문서 | 선정 |
| Pydantic v2 | 입력/응답 스키마 검증 | 선정 |
| SQLAlchemy 2.x | ORM 및 SQL 실행 | 선정 |
| Alembic | 스키마 마이그레이션 | 선정 |
| pytest + HTTPX TestClient/AsyncClient | 계산 로직과 API 테스트 | 선정 |
| CSV 모듈 / openpyxl | CSV·Excel 처리 | 선정(필요 패키지) |
| pandas | 대용량/복잡한 분석 변환이 실제 필요할 때만 도입 | 선택 |

초기 구현은 복잡한 비동기 패턴을 무조건 쓰기보다 단순한 서비스 함수와 트랜잭션부터 시작한다. I/O 병렬성이 실제 병목으로 확인되면 비동기 DB 접근 등을 검토한다.

### 5.2 백엔드 폴더 구조

```text
backend/
├── app/
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   ├── logging.py
│   │   └── security.py
│   ├── api/
│   │   ├── deps.py
│   │   └── v1/
│   │       ├── router.py
│   │       └── endpoints/
│   │           ├── stores.py
│   │           ├── tables.py
│   │           ├── visits.py
│   │           ├── menus.py
│   │           ├── ingredients.py
│   │           ├── recipes.py
│   │           ├── inventory.py
│   │           ├── analytics.py
│   │           ├── imports.py
│   │           └── integrations.py
│   ├── db/
│   │   ├── session.py
│   │   ├── base.py
│   │   └── models/
│   ├── schemas/
│   ├── services/
│   │   ├── sales_aggregation.py
│   │   ├── recipe_consumption.py
│   │   ├── inventory_calculation.py
│   │   ├── costing.py
│   │   └── data_quality.py
│   ├── repositories/        # 복잡한 조회가 생길 때 도입; 초기엔 불필요한 래퍼를 만들지 않음
│   ├── integrations/
│   │   ├── base.py
│   │   ├── toss_open_api/
│   │   ├── toss_plugin_ingest/
│   │   └── csv_excel/
│   └── worker/
│       ├── main.py
│       └── handlers.py
├── alembic/
├── tests/
│   ├── unit/
│   ├── api/
│   ├── integration/
│   └── fixtures/
├── pyproject.toml
├── alembic.ini
└── .env.example
```

### 5.3 모듈 책임

- **endpoints:** HTTP 요청/응답, 인증·권한, 입력 스키마 적용. 계산 로직을 길게 작성하지 않는다.
- **schemas:** API 요청/응답 모델. DB ORM 모델을 API 응답으로 무분별하게 직접 노출하지 않는다.
- **models:** DB 테이블, 관계, 고유 제약조건, 인덱스
- **services:** 매장 업무 규칙과 트랜잭션 조정
- **integrations:** POS별 원천 데이터 접근 및 내부 형식 변환
- **worker:** 오래 걸릴 수 있는 수집·재처리·대량 파일 처리
- **tests:** 계산 규칙, 매핑, 중복 방지, API 오류 사례를 검증

`repositories/`는 모든 테이블마다 기계적으로 만들지 않는다. 쿼리가 복잡해지거나 데이터 접근 규칙을 분리할 필요가 확인될 때 도입한다.

### 5.4 공통 API 응답/오류 원칙

- API 경로는 `/api/v1/...` 아래에 둔다.
- 입력 오류는 필드별 오류 정보를 제공해 프론트엔드가 수정 위치를 표시할 수 있게 한다.
- 미연결/권한 부족/동기화 지연/데이터 미존재를 서로 구분한다.
- 업로드 작업에는 `batch_id`를 발급하고, 미리보기·검증·확정 단계를 둔다.
- POS 웹훅은 인증/서명 검증 후 원본 이벤트를 기록한다. 제공자의 웹훅 재전송 정책과 식별자 형식을 확인해야 한다.
- 외부 API 호출 실패는 횟수 제한과 backoff를 포함한 재시도 정책을 사용한다. 무한 재시도하지 않는다.
- 내부 오류 상세나 비밀정보를 클라이언트 응답에 노출하지 않는다.

### 5.5 제안 API 목록

이 목록은 출발점이며, UI 명세와 실제 데이터 모델을 확정하며 OpenAPI 계약으로 고정한다.

| API | 목적 |
|---|---|
| `POST /api/v1/stores` | 매장 생성 |
| `GET/PATCH /api/v1/stores/{store_id}` | 매장 조회/수정 |
| `GET/POST/PATCH /api/v1/stores/{store_id}/tables` | 테이블 CRUD 및 배치 좌표 |
| `POST /api/v1/stores/{store_id}/visits` | 방문 세션 생성/인원 기록 |
| `PATCH /api/v1/stores/{store_id}/visits/{visit_id}` | 방문 기록 수정/종료 |
| `GET/POST/PATCH /api/v1/stores/{store_id}/menus` | 메뉴 관리 |
| `GET/POST/PATCH /api/v1/stores/{store_id}/ingredients` | 식자재 관리 |
| `GET/POST/PATCH /api/v1/stores/{store_id}/recipes` | 레시피 및 메뉴-식자재 관계 |
| `POST /api/v1/stores/{store_id}/imports/sales/preview` | CSV/Excel 미리보기/검증 |
| `POST /api/v1/stores/{store_id}/imports/sales/commit` | 검증된 가져오기 확정 |
| `GET /api/v1/stores/{store_id}/imports/{batch_id}` | 업로드 진행/오류 확인 |
| `POST /api/v1/stores/{store_id}/inventory/receipts` | 식자재 입고 기록 |
| `POST /api/v1/stores/{store_id}/inventory/counts` | 실재고 실사 기록 |
| `GET /api/v1/stores/{store_id}/inventory/estimated` | 예상 재고 조회 |
| `GET /api/v1/stores/{store_id}/analytics/sales` | 기간/시간대별 판매 집계 |
| `GET /api/v1/stores/{store_id}/analytics/cost-scenarios` | 메뉴 원가 시나리오 계산 |
| `GET /api/v1/stores/{store_id}/integrations/status` | 연결·마지막 성공 수집 시각 |
| `POST /api/v1/integrations/toss/events` | 공급자/플러그인 이벤트 수신(실제 계약에 따라 조정) |

POS 이벤트 수신 경로는 공급자의 인증·웹훅 계약을 확인한 후 확정한다. URL 예시를 실제 제공 API처럼 가정하지 않는다.

---

## 6. POS 및 파일 수집 아키텍처

### 6.1 세 가지 모드의 원칙

| 모드 | 구현 경계 | 데이터 흐름 | 제한 및 검증 |
|---|---|---|---|
| A. Toss Open API | 백엔드 adapter | 서버가 API 조회 및 지원 웹훅 수신 → 원본 이벤트/스냅샷 → 정규화 | 지원 필드, 권한, 웹훅 서명, 호출 제한, 과거 데이터 조회 범위를 확인 |
| B. Toss Plugin SDK | 별도 실행 패키지 + 백엔드 수신 API | POS 내부 Plugin → HTTPS 서버 전송 → 이벤트 저장/정규화 | SDK의 실행 환경, 배포 검수, 설치/활성화, 외부 네트워크 통신을 실기기에서 검증 |
| C. CSV/Excel | 백엔드 파일 import adapter | 업로드 → 미리보기 → 열 매핑/검증 → 사용자 확정 → 정규화/집계 | 파일 생성 시각/판매 시각, 주문 ID, 취소 항목, 중복 가능성을 표시 |

모드는 데이터베이스 스키마나 HOME 자체를 바꾸지 않는다. `source_mode`, `connection_status`, `last_successful_sync_at`, `available_fields` 등 설정·상태를 통해 UI가 어떤 정보를 자동으로 받는지 표현한다.

### 6.2 Adapter 인터페이스

각 adapter는 비즈니스 기능이 아니라 원천 데이터 수집에 집중한다. Python 백엔드의 개념적 인터페이스 예시는 다음과 같다.

```python
class PosAdapter(Protocol):
    async def health_check(self) -> IntegrationHealth: ...
    async def fetch_products(self, cursor: str | None = None) -> ProductPage: ...
    async def fetch_orders(self, since: datetime, cursor: str | None = None) -> OrderPage: ...
    def normalize_product(self, raw: dict) -> CanonicalProduct: ...
    def normalize_order(self, raw: dict) -> CanonicalOrder: ...
```

실제 토스 SDK/API가 이 형태를 그대로 제공한다는 뜻은 아니다. 우리 내부 구현이 서로 다른 원천을 동일한 방법으로 다루도록 만드는 인터페이스 예시다. Plugin SDK가 별도 TypeScript 런타임이라면 POS 내부에서 이벤트를 수집해 서버가 정의한 JSON 계약에 맞춰 전송한다.

### 6.3 공통 이벤트 계약

가능하면 모든 원천을 내부적으로 다음 메타데이터와 함께 기록한다.

```json
{
  "store_id": "internal-store-id",
  "source_mode": "TOSS_OPEN_API | TOSS_PLUGIN | CSV_IMPORT | MANUAL",
  "source_connection_id": "connection-id-or-null",
  "source_event_id": "provider-event-id-or-null",
  "external_order_id": "provider-order-id-or-null",
  "event_type": "order.created | order.updated | order.cancelled | product.updated",
  "occurred_at": "2026-10-25T03:10:00Z",
  "received_at": "2026-10-25T03:10:02Z",
  "timestamp_basis": "item_added_at | order_created_at | payment_at | file_field | unknown",
  "payload_version": 1,
  "payload": {}
}
```

위 JSON은 내부 계약 예시이며, 실제 payload는 비밀정보를 제외한 원천 데이터 구조에 맞게 정의한다. 원천에서 제공되지 않는 필드는 `null`로 두고 추정값을 실제 필드처럼 채우지 않는다.

### 6.4 웹훅 및 중복 처리

- 공급자가 이벤트 ID를 제공하면 `(source_connection_id, source_event_id)`에 고유 제약을 둔다.
- 주문/주문항목은 공급자별 외부 ID와 매핑한다. 주문 전체 ID와 주문 항목 ID를 혼동하지 않는다.
- 이벤트 ID가 없는 소스는 외부 주문 ID, 업데이트 시각, 항목 ID 등으로 중복 가능성을 검사한다. 조합 키가 보장되지 않으면 무조건 자동 삭제하지 말고 미리보기/검토를 제공한다.
- 이벤트를 받은 시점과 이벤트가 실제 발생한 시점을 모두 저장한다.
- 처리 상태는 예: `received`, `processing`, `processed`, `retryable_error`, `dead_letter`로 구분한다.
- 재처리는 동일 데이터를 다시 적용해도 최종 판매량/재고가 중복 증가하지 않는 멱등성을 보장한다.
- 원본 이벤트는 진단·재처리에 필요한 기간 동안 보존하되, 불필요한 개인정보나 카드정보는 저장하지 않는다.

### 6.5 CSV/Excel 가져오기 단계

1. 파일 형식과 크기 검증
2. 파일을 임시/보호 저장소에 두고 `import_batch` 생성
3. 시트/헤더 탐지 및 사용자가 열을 매핑
4. 행별 필수값·날짜·숫자·메뉴 매핑 검증
5. 중복 가능 행과 미매핑 메뉴 표시
6. 사용자 확정
7. 트랜잭션 내에서 정상 행 반영, 오류 행 보고서 저장
8. 가져오기 결과와 마지막 포함 시각 표시

가져오기 미리보기 없이 바로 DB를 변경하지 않는다. 이전 파일을 다시 올렸을 때 같은 데이터를 중복 등록하지 않도록 파일 해시, batch 이력, 원천 거래 식별자 등을 조합한다. 파일에 고유 주문/행 ID가 없다면 “완전 자동 중복 판별”을 보장하지 않고 중복 가능성 보고를 제공한다.

### 6.6 시간대별 판매량의 시각 기준

판매량 시간대 집계에서 다음 시각은 서로 다르다.

- 주문 전체 생성 시각
- 개별 메뉴가 주문에 추가된 시각
- 주문 변경 시각
- 결제 시각
- 시스템이 이벤트를 수신한 시각

메뉴가 추가된 시각을 소스에서 받으면 그 시각을 사용한다. 그렇지 않으면 주문 생성 시각 등을 대체 기준으로 쓰되 `timestamp_basis`를 기록하고 화면에 “주문 생성 시각 기준”처럼 표현한다. 결제 시각을 주문 시각과 동일하게 취급하지 않는다.

### 6.7 모드 전환

- 기존 연결 정보를 보존한다.
- 모드 전환 직전/직후의 수집 범위가 겹칠 수 있으므로 원천 ID/이벤트 ID를 통해 중복을 방지한다.
- 새 모드의 연결 및 권한 검증이 완료되기 전 기존 수집을 무조건 비활성화하지 않는다.
- CSV 모드에서는 `last_successful_import_at`과 데이터 파일의 마지막 포함 시각을 표시한다.
- 연결 실패가 데이터 삭제나 기존 이력 초기화를 유발하지 않게 한다.

---

## 7. 데이터베이스 선택 및 논리 모델

### 7.1 PostgreSQL을 선택하는 이유

이 서비스는 매장·테이블·주문·메뉴·레시피·식자재·입고·재고 사이의 관계를 엄격하게 관리해야 한다. 동일한 이벤트가 중복 처리되는 것을 막고, 주문과 재고 데이터를 하나의 트랜잭션 범위에서 일관되게 반영해야 하므로 관계형 DB가 적합하다.

- 개발과 파일럿에서도 PostgreSQL을 사용해 로컬/운영 간 차이를 줄인다.
- 호스팅이 지원하면 PostgreSQL 18.x를 선택한다. 호스팅 지원이나 안정성 요구로 불가능하면 지원 기간이 남은 PostgreSQL 17.x를 사용한다.
- SQLite는 간단한 단위 테스트/독립 도구에는 가능하지만, 주 개발/파일럿 DB를 대체하지 않는다.
- 매출 집계나 재고 계산을 JSON 파일로만 보관하지 않는다.

PostgreSQL 공식 버전 정책은 버전 지원 기간을 공개하고 있으므로 새 환경을 만들 때 지원 중인 메이저 버전과 호스팅 지원을 확인한다.

### 7.2 권장 논리 엔티티

아래는 첫 구현을 위한 논리 모델이다. 실제 DDL/컬럼/삭제 정책은 데이터 스키마 확정 시 결정한다.

| 엔티티 | 주요 필드/관계 | 목적 |
|---|---|---|
| `stores` | id, name, timezone, opening_hours, created_at | 매장 기본정보. 현재 1개 매장이라도 store_id를 모든 업무 데이터에 유지 |
| `store_tables` | id, store_id, name, seats, layout_x, layout_y, is_active | 도트 배치도와 좌석 관리 |
| `visit_sessions` | id, store_id, table_id, party_size, age_band, seated_at, left_at, source, status | 방문/착석 기록. 결제와 퇴점 분리 |
| `pos_connections` | id, store_id, mode, status, credentials_ref, capabilities, last_sync_at | 연결 모드·상태. 실제 토큰 값은 프론트엔드에 노출하지 않음 |
| `sync_runs` | id, connection_id, started_at, finished_at, status, counters, error_summary | API 동기화 이력 |
| `integration_events` | id, connection_id, source_event_id, type, occurred_at, received_at, payload_json, status | 수신 원본 이벤트와 재처리 상태 |
| `import_batches` | id, store_id, file_hash, file_name, uploaded_at, status, mapping_json, counts | CSV/Excel 업로드 단위·중복·오류 이력 |
| `import_rows` (필요 시) | batch_id, row_number, raw_row_json, validation_status, error_message | 행별 검증 오류와 검토 결과 |
| `menu_items` | id, store_id, name, selling_price, category, active, created_at | 내부 메뉴 마스터 |
| `pos_product_mappings` | id, connection_id, external_product_id, menu_item_id, external_name | POS 상품과 내부 메뉴 연결. 고유성 제약 필요 |
| `sales_orders` | id, store_id, source, external_order_id, table_id nullable, ordered_at, source_updated_at, status | 내부 표준 주문 |
| `sales_order_items` | id, order_id, external_item_id nullable, menu_item_id nullable, name_snapshot, quantity, unit_price, status, item_time_basis | 메뉴 항목과 수량/시각/상태 |
| `ingredients` | id, store_id, name, base_unit, purchase_unit, conversion_factor, active | 식자재 마스터와 단위 변환 |
| `recipes` | id, store_id, menu_item_id, version, effective_from, effective_to, status | 메뉴별 레시피 버전. 과거 소비량 계산에 과거 레시피 필요 여부 고려 |
| `recipe_items` | id, recipe_id, ingredient_id, quantity, unit | 한 레시피에 포함된 식자재와 1인분 사용량 |
| `suppliers` | id, store_id, name, contact_optional | 공급업체(초기에는 선택 기능) |
| `inventory_receipts` | id, store_id, ingredient_id, supplier_id nullable, received_at, quantity, purchase_unit, total_cost, unit_cost, source | 실제 입고 및 구매가격 이력 |
| `inventory_counts` | id, store_id, ingredient_id, counted_at, actual_quantity, unit, counted_by_optional | 실재고 실사값. 계산값과 구분 |
| `inventory_adjustments` | id, store_id, ingredient_id, occurred_at, quantity_delta, reason, source | 폐기/조정 등 재고 증감의 원인 기록. UI 범위는 단계적 적용 |
| `data_quality_issues` | id, store_id, source_id, code, severity, status, details, created_at | 미매핑 메뉴, 잘못된 단위, 누락 데이터 경고 |
| `audit_events` (최소 구현 가능) | actor, entity, action, occurred_at, change_summary | 중요 설정·레시피 수정 이력 추적 |

**구현 주의:** 위 표는 모든 테이블을 첫날에 한꺼번에 만들라는 지시가 아니다. 첫 MVP에서 필요한 엔티티부터 migration으로 단계적으로 추가한다. 다만 이벤트·주문·입고의 원천 식별자와 이력 보존은 처음부터 설계한다.

### 7.3 핵심 관계

```mermaid
erDiagram
  STORES ||--o{ STORE_TABLES : contains
  STORE_TABLES ||--o{ VISIT_SESSIONS : hosts
  STORES ||--o{ MENU_ITEMS : owns
  MENU_ITEMS ||--o{ RECIPES : has_versions
  RECIPES ||--o{ RECIPE_ITEMS : contains
  INGREDIENTS ||--o{ RECIPE_ITEMS : used_in
  STORES ||--o{ INGREDIENTS : owns
  STORES ||--o{ SALES_ORDERS : records
  SALES_ORDERS ||--o{ SALES_ORDER_ITEMS : contains
  MENU_ITEMS ||--o{ SALES_ORDER_ITEMS : maps_to
  POS_CONNECTIONS ||--o{ POS_PRODUCT_MAPPINGS : defines
  MENU_ITEMS ||--o{ POS_PRODUCT_MAPPINGS : mapped_by
  INGREDIENTS ||--o{ INVENTORY_RECEIPTS : replenished_by
  INGREDIENTS ||--o{ INVENTORY_COUNTS : counted_by
  POS_CONNECTIONS ||--o{ INTEGRATION_EVENTS : receives
  STORES ||--o{ IMPORT_BATCHES : imports
```

### 7.4 DB 제약조건 및 인덱스 원칙

- 모든 매장 업무 데이터는 `store_id` 범위 안에서 조회/수정한다.
- 메뉴명만으로 POS 상품과 연결하지 않는다. 외부 상품 ID와 내부 메뉴 ID를 매핑한다.
- 수량과 가격은 음수/0 허용 여부를 업무 규칙으로 정의한다. 취소는 기존 이력의 상태 변경 또는 명시적 취소 이벤트로 표현한다.
- 금액은 부동소수점이 아니라 정밀한 decimal/numeric 타입으로 저장한다.
- 수량은 소수점이 필요한 식자재를 고려해 decimal/numeric 타입을 사용한다.
- 시각은 timezone-aware datetime으로 저장하고 내부 표준은 UTC를 사용한다. 사용자 표시와 영업시간 집계는 매장 timezone(기본 `Asia/Seoul`)을 사용한다.
- 공급자 이벤트 ID가 있으면 원천 연결과 함께 unique 제약을 둔다.
- 외부 주문 ID/항목 ID의 고유성은 공급자의 보장 범위를 확인한 뒤 제약으로 설정한다.
- FK의 `ON DELETE CASCADE`를 무심코 사용해 과거 매출/원가 근거가 함께 지워지지 않게 한다. 업무 이력은 비활성/보존 정책을 우선 검토한다.
- 쿼리 성능을 확인한 뒤 날짜/매장/메뉴/상태 등 필터 컬럼에 인덱스를 추가한다. 모든 컬럼에 습관적으로 인덱스를 만들지 않는다.

### 7.5 레시피 변경 및 과거 계산

레시피가 바뀌면 과거 판매에 새 레시피를 적용할지, 당시 레시피를 유지할지 구분해야 한다. 가능하면 `version`과 `effective_from/effective_to`를 사용해 유효기간을 관리한다. 실제로 버전 관리를 구현하기 전까지 과거 수치가 재계산될 수 있음을 UI에서 명확히 하고, 조용히 과거값을 바꾸지 않는다.

---

## 8. 판매·재고·원가 계산 규칙

### 8.1 판매량

- 시간 단위 집계 기준은 매장 현지시간(`Asia/Seoul`)으로 표시한다.
- 이벤트 시각 근거가 `item_added_at`이면 메뉴 추가 시각 기준 집계를 우선한다.
- 개별 메뉴 추가 시각을 받지 못한다면 주문 생성 시각을 사용하되 해당 기준을 UI에 표시한다.
- 결제 취소/주문 취소/수량 감소를 반영한 최종 유효 수량을 계산한다.
- 총 주문량과 취소 후 순판매량을 혼동하지 않도록 내부 정의를 문서화한다.
- 주문과 주문 항목은 원천 이벤트를 통해 갱신하며, 재수집이 수량을 누적 더하는 방식으로 처리하지 않는다.

### 8.2 레시피 기반 이론상 소비량

`이론상 소비량 = 유효 판매 수량 × 해당 시점에 적용되는 레시피의 1인분 사용량`

- 메뉴/레시피가 연결되지 않은 판매는 판매 집계에서 버리지 않는다. 판매는 유지하고 미매핑 상태를 표시한다.
- 단위 변환은 명시된 변환표나 변환 계수를 이용한다.
- 재료 손질/조리 수율이 필요하다면 별도 파라미터로 모델링한다. 초기 버전에서 임의로 손실률을 가정하지 않는다.

### 8.3 예상 재고

`예상 재고 = 기준 실재고 + 이후 입고 − 이후 이론상 소비량 − 별도 식자재 폐기량 ± 조정량`

- 기준 실재고가 언제 측정됐는지 저장한다.
- 예상 재고와 실재고를 별도 필드/개념으로 관리한다.
- 손님 잔반은 이미 판매 메뉴의 이론상 소비량에 포함된 음식이므로, 잔반을 식자재 재고에서 다시 빼지 않는다.
- 조리 중 폐기/유통기한 경과처럼 미사용 식자재의 폐기는 별도의 재고 증감으로 기록한다.
- 예상 재고가 음수여도 숨기지 않고 데이터 누락/실재고 확인 필요 경고를 표시한다.

### 8.4 원가 시나리오

- 구매 단가 이력은 입고 기록에서 유지한다.
- 메뉴별 원가는 레시피 수량 × 선택된 구매 단가 기준으로 계산한다.
- `최근 구매단가`, `기간 가중평균` 등 기본 원가 기준은 미결정 사항이므로 확정 전에는 기준을 화면에 표시한다.
- 원가 시나리오는 계산 결과이며 실제 회계 손익이나 최종 공헌이익으로 과장하지 않는다.
- 인건비/임차료/공과금 등이 빠져 있으면 “식재료 원가”와 “식재료비 비율”로만 표시한다.

---

## 9. 파일럿 배포·운영 구조

### 9.1 개발 환경

초기에는 Docker Compose를 이용해 개발 환경을 통일한다.

```text
Docker Compose (development)
├── frontend-dev   # Vite 개발 서버
├── api             # FastAPI
├── worker          # 이벤트/재처리 작업; 필요 시 같은 이미지의 별도 프로세스
└── postgres        # PostgreSQL
```

- `.env`는 로컬에서만 사용하고 저장소에 commit하지 않는다.
- `.env.example`에는 변수명과 설명만 기록하고 실제 토큰·비밀번호는 넣지 않는다.
- DB migration으로 스키마를 적용하며, 애플리케이션 실행 시 임의로 운영 테이블을 자동 변경하지 않는다.

### 9.2 파일럿/운영 환경

아직 클라우드 공급자·도메인·비용이 확정되지 않았다. 공급자를 고정하기 전에는 다음 조건을 만족하는 배포 옵션을 비교한다.

- HTTPS 제공
- API 및 worker 실행 지원
- 지속 저장이 가능한 PostgreSQL 또는 관리형 DB 연결
- 백업 및 복구 방법 명시
- 로그와 오류 확인 가능
- 비밀정보를 환경변수/Secret 기능으로 저장
- DB를 인터넷에 직접 공개하지 않음
- 데이터 내보내기/복원 방법 확보

한 서버에 모든 서비스를 둘 수는 있지만, 파일럿 운영 DB를 개발용 컨테이너와 같은 데이터 볼륨에서 무보호로 운영하지 않는다. 운영 전에 백업을 복원하는 테스트를 한 번 수행한다.

### 9.3 네트워크와 경로

배포 시에는 HTTPS reverse proxy 또는 플랫폼 라우팅을 통해 프론트엔드와 API를 제공한다. 동일 도메인 아래 `/api`를 API로 전달하는 구성을 우선 검토하면 CORS 설정이 단순해진다. 별도 도메인으로 분리할 경우 허용 origin을 정확하게 제한한다.

### 9.4 실시간 갱신

- 초기 HOME은 POS 연결 상태에 맞게 짧은 polling(예: 10~20초)과 사용자 수동 새로고침으로 시작할 수 있다. 실제 필요와 API 호출 제한에 따라 간격을 조정한다.
- 대시보드 통계는 빈번한 실시간 갱신이 필요하지 않다면 더 긴 간격으로 갱신한다.
- 여러 탭, 많은 사용자, 서버 푸시 요구가 실제로 발생하면 SSE를 검토한다. 초기부터 WebSocket을 도입하지 않는다.
- CSV/Excel 모드의 데이터는 업로드 시점까지의 정보이므로 polling이 실시간성을 만들어 주지 않는다는 점을 표시한다.

### 9.5 작업 큐와 스케줄러

초기에는 Redis/Celery 같은 별도 큐를 필수 의존성으로 추가하지 않는다.

- 파일이 작고 동기 검증이 빠른 경우 요청 내에서 미리보기를 반환할 수 있다.
- 외부 이벤트는 우선 `integration_events`에 저장하고 처리 상태를 관리한다.
- 재처리·API reconciliation·대량 파일 처리가 필요하면 같은 백엔드 코드베이스의 worker가 DB에서 미처리 작업을 가져오게 한다.
- worker 작업은 재시도해도 중복 주문/재고 증감을 만들지 않도록 설계한다.
- 운영 요구가 커지고 DB polling이 병목이 되는 경우에만 외부 메시지 브로커를 검토한다.

---

## 10. 보안·개인정보·운영 신뢰성

### 10.1 비밀정보

- POS API 토큰/비밀키는 프론트엔드·PWA·브라우저 localStorage에 저장하지 않는다.
- 백엔드에서만 외부 POS API를 호출한다. Plugin은 공식적으로 승인된 구조에 한해 필요한 이벤트를 서버로 전송한다.
- 배포 환경에서는 플랫폼 Secret 기능을 우선 사용한다. 로그, 예외 메시지, 테스트 데이터에 토큰을 남기지 않는다.
- 비밀키가 노출되었다고 판단되면 회전/폐기하고 관련 로그를 확인한다.

### 10.2 인증 및 매장 범위

- 로컬 개발 환경 외에 인터넷으로 공개되는 서비스는 인증 없이 운영하지 않는다.
- 단일 매장 파일럿이라도 업무 테이블에는 `store_id` 범위를 두어 향후 데이터 격리를 유지한다.
- 매장 ID를 요청값으로 받는다고 해서 접근 권한이 있다고 간주하지 않는다. 인증 사용자와 매장 권한을 백엔드에서 검증한다.
- 로그인/세션 구현 라이브러리와 계정 복구 절차는 배포 방식 확정 전 기술 결정으로 남긴다. 브라우저 `localStorage`에 장기 인증 토큰을 넣는 방식을 기본값으로 삼지 않는다.

### 10.3 개인정보 최소화

- 고객 이름·전화번호·얼굴 식별을 초기 범위에서 요구하지 않는다.
- 연령대는 선택적 집계값만 검토하고, 개인 단위 식별이나 자동 프로파일링을 하지 않는다.
- 카메라 기반 연령 추정/폐기 인식은 MVP 범위가 아니며, 별도 법적·기술적 검토와 파일럿 동의 절차가 필요하다.
- 매장 직원 이름 등 개인 정보는 실제 필요가 확인될 때만 수집한다.

### 10.4 로그·백업·복구

- 주요 동작: POS 수집 성공/실패, import batch 상태, 이벤트 처리 실패, 주문 매핑 실패, DB migration 결과를 기록한다.
- 로그에는 식별에 꼭 필요한 내부 ID만 사용하고 payload 전체/비밀정보를 무차별 기록하지 않는다.
- 운영 DB 정기 백업과 복원 테스트를 시행한다.
- import batch, 원본 이벤트, 주문/입고 기록은 임의로 삭제하지 않고 보존/정정 정책을 따른다.
- 중요한 설정·레시피 변경은 변경 전후를 추적할 수 있도록 한다.

---

## 11. 개발 규칙 및 품질 게이트

### 11.1 코드 품질

**Frontend**
- TypeScript `strict` 활성화
- ESLint 및 Prettier 적용
- UI와 업무 계산 로직 분리
- API 오류 상태를 사용자에게 한국어로 설명

**Backend**
- Ruff 또는 동등한 formatter/linter 적용
- 타입 힌트 사용
- Pydantic으로 외부 입력 검증
- DB 변경은 Alembic migration으로 관리
- 환경별 설정은 설정 모듈과 환경변수로 관리

### 11.2 필수 테스트

| 테스트 | 기대 결과 |
|---|---|
| 같은 POS 이벤트 재수신 | 주문/수량이 중복 반영되지 않음 |
| 주문 수량 감소·취소 | 순판매량이 정확히 조정됨 |
| 원천에 개별 메뉴 시각 없음 | 대체 시각 기준과 데이터 한계를 표시 |
| CSV 같은 파일 재업로드 | 중복 가능성을 감지하고 임의 중복 추가를 막음 |
| CSV 일부 행 오류 | 정상/오류 행을 분리하고 오류 내용을 제공 |
| 메뉴 미매핑 | 판매는 보존하고 미매핑 이슈를 생성 |
| g/kg 변환 | 단위 변환 결과가 정확함 |
| 레시피 소비량 | 판매 수량 × 1인분 사용량이 맞음 |
| 입고/실재고/조정 | 예상 재고 수식이 정확히 적용됨 |
| 잔반 기록 | 판매에 이미 반영된 식자재를 재고에서 이중 차감하지 않음 |
| 모드 변경 | 기존 데이터와 이력이 보존되고 중복 수집이 없음 |
| 네트워크 장애/재시도 | 실패 상태가 표시되고 재처리로 중복이 생기지 않음 |
| 타 매장 데이터 요청 | 권한 없는 데이터가 반환되지 않음 |

### 11.3 완료 기준

기능 완료는 “화면이 보인다”만으로 판단하지 않는다.

1. UI 명세서의 입력·버튼·상태·이동 규칙을 충족한다.
2. API 검증·권한 오류와 네트워크 실패를 처리한다.
3. 핵심 계산의 단위/수량 테스트가 통과한다.
4. 데이터 출처 및 마지막 동기화 상태가 표시된다.
5. POS 실연동 여부와 mock/fixture 사용 범위가 보고서에 명확히 기재된다.
6. 관련 기획/아키텍처 문서와 실행 방법을 갱신한다.

---

## 12. 구현 순서

### Phase 0 — 저장소와 POS 기술 검증

- 현재 저장소가 있다면 기존 패키지·환경·코드를 먼저 조사한다.
- 실제 파일럿 매장 POS 제품/모델과 API 이용 권한을 확인한다.
- Open API와 Plugin SDK의 개발·승인·배포 조건, 주문 ID/항목 ID, 시각, 테이블 필드를 확인한다.
- 샘플 CSV/Excel 파일을 확보하고 판매 시각·취소·항목 ID 유무를 확인한다.
- 이 단계가 끝나기 전 특정 POS가 모든 필드를 제공한다고 전제하지 않는다.

### Phase 1 — 기반 프로젝트

- `frontend/`, `backend/`, `pos-plugin/`(실제 필요 시) 구조 확정
- React TS/Vite, FastAPI, PostgreSQL, Alembic 실행
- Docker Compose 개발 환경
- 환경변수 예제, lint, 테스트 실행법, README
- 매장/테이블/메뉴/식자재의 최소 DB migration

### Phase 2 — 마스터 데이터와 CSV 흐름

- 매장 등록 및 테이블 배치 설정
- 메뉴·식자재·레시피 CRUD
- CSV/Excel import 미리보기·행 검증·확정
- 공통 주문 및 주문항목 모델
- 중복/미매핑 오류 표시

CSV 모드는 POS에 관계없이 파이프라인을 검증할 수 있는 기준 어댑터다. 다만 실제 파일에서 필요한 시간·수량·식별자 필드를 얻을 수 있는지 먼저 확인한다.

### Phase 3 — POS A/B 어댑터

- Open API 인증 및 주문·상품 조회
- 웹훅/이벤트 수신과 중복 방지
- API 재조회/누락 복구 절차
- Plugin SDK 별도 패키지와 서버 이벤트 계약(승인/설치 환경 확보 후)
- 실제 POS 테스트 주문으로 주문·추가 주문·취소를 검증

### Phase 4 — HOME 및 방문 기록

- 도트 배치도와 테이블 상태
- 방문 세션 생성/종료
- POS에서 얻을 수 있는 인원·테이블 데이터의 자동 채움
- 자동으로 못 받는 필드만 현장 입력
- 결제 완료와 실제 퇴점 구분

### Phase 5 — 입고·재고·원가

- 입고와 가격 이력
- 실재고 실사
- 레시피 기반 이론 소비량
- 예상 재고와 기준 재고 알림
- 메뉴 원가 시나리오

### Phase 6 — PWA, 대시보드, 파일럿 개선

- PWA 설치/업데이트 UX
- 판매량·재고·원가 분석 화면
- 현장 입력 시간/누락/데이터 품질 측정
- 파일럿 검증 후 오프라인 입력·AI 문서 추출 등을 우선순위화

---

## 13. 기술 결정 기록(ADR)

| ADR | 결정 | 상태 | 재검토 조건 |
|---|---|---|---|
| ADR-001 | React + TypeScript + Vite SPA | 선정 | SSR/SEO 요구가 제품 목표에 들어올 경우 |
| ADR-002 | FastAPI 백엔드 | 선정 | 팀 기술 역량/배포 제약 변화 |
| ADR-003 | PostgreSQL 관계형 DB | 선정 | 저장/조회 규모 또는 오프라인/엣지 운영 요구 변화 |
| ADR-004 | 모듈형 모놀리스 + 같은 코드베이스 worker | 선정 | 서비스 독립 배포/확장 요구가 측정될 경우 |
| ADR-005 | POS A/B/C는 adapter 경계로 분리 | 선정 | 특정 공급자 SDK 구조가 공통 인터페이스에 큰 제약을 줄 경우 |
| ADR-006 | 초기 화면 갱신은 REST polling | 선정 | 빈번한 양방향 실시간 요구가 확인될 경우 SSE/WebSocket 검토 |
| ADR-007 | Redis/Kafka/Kubernetes는 MVP에서 제외 | 선정 | 처리량/복구/운영 지표가 필요성을 입증할 경우 |
| ADR-008 | 계산 핵심부는 결정론적 코드 | 확정 | AI는 설명·추출·후보 추천 등 보조 기능으로 검토 |
| ADR-009 | PWA 오프라인 기록은 별도 단계 | 선정 | 파일럿에서 연결 불안정과 기록 손실 문제가 검증될 경우 |
| ADR-010 | 단일 매장 파일럿이나 store_id는 전 엔티티에 유지 | 선정 | 없음. 데이터 격리와 확장성의 기본 규칙 |
| ADR-011 | 클라우드·인증 상세 기술 선택 | 미결정 | 실제 배포 대상, 비용, 보안 요건 확인 후 결정 |
| ADR-012 | 재고 원가 기준(최근 단가/가중평균 등) | 미결정 | 사장님 인터뷰 및 실제 구매 데이터 확인 후 결정 |

ADR은 기술 결정을 추적하기 위한 기록이다. 결정을 바꿀 때 기존 줄을 지우는 대신 상태/날짜/변경 사유를 남긴다.

---

## 14. 미결정 사항 및 의존성

| ID | 항목 | 영향 | 결정 방법 |
|---|---|---|---|
| D-01 | 파일럿 매장의 실제 POS 모델·계정 | A/B/C 중 현실적 경로 | 매장 인터뷰 및 공급사 확인 |
| D-02 | Open API로 제공되는 메뉴/주문/시간 필드 | 시간대 판매량 정확도 | 공식 API 문서와 테스트 이벤트 확인 |
| D-03 | Plugin SDK 설치·검수·배포 권한 | 모드 B 가능 여부 | 공식 개발 지원/파트너 절차 확인 |
| D-04 | 방문 기록 시작 시점 | HOME/테이블 UX, 방문 데이터 완전성 | 현장 시나리오 인터뷰 |
| D-05 | 방문 인원/연령대 기록 형태 | 입력 부담 및 분석 가능성 | 데이터 가치와 현장 부담 비교 |
| D-06 | 메뉴별 시간 집계의 기준 시각 | 시간대 분석 해석 | POS 필드 검증, fallback 기준 결정 |
| D-07 | 기본 구매 단가 정책 | 메뉴 원가 계산 | 고객/회계 관점 인터뷰 |
| D-08 | 실재고 실사 빈도 | 입력 부담과 재고 신뢰도 | 파일럿 측정 |
| D-09 | 배포 공급자와 인증 방식 | 비용·보안·복구 | 사용 목적과 예산 확정 후 선정 |
| D-10 | 오프라인 저장 범위 | 태블릿 기록 안정성 | 실제 매장 네트워크 테스트 |
| D-11 | 연령대 데이터의 수집 정책 | 입력 UX·개인정보 검토 | 목적 명확화 및 별도 검토 |

---

## 15. 에이전트 구현 지침

1. 변경 전에 `음식점_AX_통합기획서_v1.0.md`, 최신 UI 명세서, 본 아키텍처 문서, `AGENTS.md`를 읽는다.
2. 기존 저장소와 버전/패키지를 확인하고 이미 존재하는 구조를 불필요하게 재작성하지 않는다.
3. API/Plugin 연동 미검증 시 mock mode와 real mode를 UI·로그에서 구분한다.
4. POS 모드별로 별도 메뉴/재고 계산 로직을 만들지 않는다. adapter 이후 동일한 서비스 계층을 사용한다.
5. 구매 원가, 재고, 판매 집계는 단위 테스트가 가능한 순수 함수/서비스로 구현한다.
6. 데이터 스키마 변경은 Alembic migration으로 추가한다. 운영 DB를 임의로 재생성하지 않는다.
7. 실제 고객 데이터나 토큰을 테스트 fixture에 사용하지 않는다.
8. 수기 입력을 추가하기 전에 해당 데이터를 POS/기존 파일에서 가져올 수 있는지 먼저 확인한다.
9. 사용자가 결정하지 않은 내용은 `PROVISIONAL`로 표시하고 의사결정 목록에 남긴다.
10. 작업 완료 보고에 변경 파일, 실행 방법, 테스트 결과, 실제 POS 연동 검증 범위, 남은 TODO를 포함한다.

---

## 16. 시작 명령 및 환경 예시

아래는 시작점이며, 버전은 프로젝트 생성 시 공식 호환성 안내를 확인하고 lockfile로 고정한다.

### 16.1 프론트엔드 초기화

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm run dev
```

### 16.2 백엔드 개발 환경(예시)

```bash
cd backend
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install --upgrade pip
pip install fastapi uvicorn[standard] pydantic sqlalchemy alembic psycopg[binary] pytest httpx openpyxl
```

실제 프로젝트에서는 설치된 패키지와 버전을 `pyproject.toml` 또는 lockfile로 고정한다. 운영 배포에서는 개발 의존성과 런타임 의존성을 분리한다.

### 16.3 환경변수 예시

`.env.example`에는 이름과 설명만 둔다.

```env
APP_ENV=development
API_PREFIX=/api/v1
DATABASE_URL=postgresql+psycopg://app_user:change_me@localhost:5432/restaurant_ax
APP_TIMEZONE=Asia/Seoul
CORS_ALLOWED_ORIGINS=http://localhost:5173
POS_MODE=csv
POS_CLIENT_ID=
POS_CLIENT_SECRET=
POS_WEBHOOK_SECRET=
```

위 URL과 자격 증명은 예시다. 실제 비밀번호·토큰을 문서나 Git에 저장하지 않는다.

---

## 17. 공식 문서 및 참고 자료

기술 버전과 동작은 변경될 수 있으므로, 구현 시 공식 문서를 다시 확인한다. 아래 확인 기준일은 2026-10-25다.

- Vite 시작 가이드: https://vite.dev/guide/
- React TypeScript 가이드: https://react.dev/learn/typescript
- React 앱 생성 접근법: https://react.dev/learn/creating-a-react-app
- FastAPI 첫 단계 및 OpenAPI 자동 문서: https://fastapi.tiangolo.com/tutorial/first-steps/
- FastAPI 관계형 DB 가이드: https://fastapi.tiangolo.com/tutorial/sql-databases/
- SQLAlchemy 2.x ORM 문서: https://docs.sqlalchemy.org/en/20/orm/
- Alembic 마이그레이션 가이드: https://alembic.sqlalchemy.org/en/latest/tutorial.html
- PostgreSQL 지원 버전 정책: https://www.postgresql.org/support/versioning/
- TanStack Query React 개요: https://tanstack.com/query/latest/docs/framework/react/overview
- Vite PWA 플러그인 문서: https://vite-pwa-org.netlify.app/
- Toss Place 개발 문서: https://docs.tossplace.com/
- OKPOS 외부 연동 문서: https://okpos.gitbook.io/okpos/table_qr_pay/okpos/okpos-okdc

---

## 18. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|---|---|---|
| v1.0 | 2026-10-25 | React+TypeScript+Vite, FastAPI, PostgreSQL, adapter 기반 POS 수집, PWA, DB·배포·보안·테스트 아키텍처의 최초 선정안 작성 |
