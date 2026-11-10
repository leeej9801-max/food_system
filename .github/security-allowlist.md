# CI 보안 검사 예외 목록

CI `security` job(`.github/workflows/ci.yml`)이 막는 것:
- `pip-audit`: `backend/requirements.deploy.txt`의 알려진 취약점 전부
- `npm audit --omit=dev --audit-level=high`: 프론트 배포 의존성의 high 이상
- `gitleaks`: 저장소 전체 이력의 비밀값

예외를 넣는 방법
- pip-audit: 워크플로 명령에 `--ignore-vuln <ID>` 추가
- npm audit: 고칠 수 없는 high 이상은 이 표에 적고 해당 패키지를 `overrides`로 고정
- gitleaks: 저장소 루트 `.gitleaksignore`에 fingerprint 한 줄

예외마다 아래 표에 한 줄을 적는다. 근거 없는 예외는 넣지 않는다.

| 도구 | ID / fingerprint | 대상 | 근거 | 추가일 | 재검토일 |
|---|---|---|---|---|---|
| (없음) | | | | | |

2026-11-10 첫 실행: 세 검사 모두 발견 0건.
