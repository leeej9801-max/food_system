# 음식점 AX 데이터 수집·운영 최적화 서비스

1~2인이 운영하는 소규모 음식점에서 현장 데이터 입력 부담을 최소화하고, POS·CSV/Excel·간편 기록 데이터를 공통 파이프라인으로 표준화하여 메뉴 원가·재고·운영 분석에 연결하는 웹 기반 서비스입니다.

## 문서 허브 (Obsidian Vault)

- 모든 기획·아키텍처·UI·작업지시서·구현보고서·리뷰 문서는 **`DOCS/`** 폴더를 Obsidian Vault 루트로 열어 확인합니다.
- 시작점: [`DOCS/00_프로젝트_허브.md`](DOCS/00_프로젝트_허브.md)
- 에이전트 작업 규약: [`AGENTS.md`](AGENTS.md) 및 [`DOCS/05_운영/개발에이전트_작업규약.md`](DOCS/05_운영/개발에이전트_작업규약.md)

## 디렉터리 구조

- `DOCS/` — Obsidian Vault (기획·아키텍처·UI·운영·WO/IR/REV/TEST)
- `backend/` — FastAPI + SQLAlchemy 2.x + Alembic + pytest
- `frontend/` — React + TypeScript + Vite + TanStack Query + Tailwind CSS
- `db/` — 로컬 개발용 PostgreSQL 17 Docker Compose (`db/docker-compose.yml`)

## 로컬 실행 방법

### 1. 데이터베이스 준비

- **권장 (PostgreSQL Docker Compose):** Docker Desktop 실행 후
  ```powershell
  cd c:\dev\food\db
  docker compose up -d
  ```
  이후 `backend/.env`에 `backend/.env.example`의 PostgreSQL `DATABASE_URL`을 설정합니다.
- **Docker 미실행 시 임시 로컬 개발 (PROVISIONAL P-07):** `.env` 없이 실행하면 기본적으로 `sqlite:///./local_dev.db`를 사용합니다.

### 2. 백엔드 실행 (FastAPI)

```powershell
cd c:\dev\food\backend
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8000
```

- 헬스 체크: `http://localhost:8000/health`
- OpenAPI 문서: `http://localhost:8000/docs`

### 3. 프론트엔드 실행 (Vite React)

```powershell
cd c:\dev\food\frontend
npm run dev
```

- 브라우저 접속: `http://localhost:5173`

## 자동 테스트 및 검증 명령

```powershell
# 백엔드 린트 & 테스트
cd c:\dev\food\backend
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\pytest.exe -v

# 프론트엔드 타입검사 & 단위 테스트 & 프로덕션 빌드
cd c:\dev\food\frontend
npm run typecheck
npm run test
npm run build

# Obsidian Vault 내부 링크([[wikilink]]) 무결성 검사
powershell -ExecutionPolicy Bypass -File c:\dev\food\DOCS\_scripts\check-links.ps1
```
