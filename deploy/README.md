# Windows Docker 배포 — lci-prod /food

## 구성
`compose.yaml`: PostgreSQL 17 영구 볼륨 → Alembic → FastAPI → Nginx(빌드된 React).
기존 `lci-prod-cloudflared-1`을 재사용한다. 웹 컨테이너만 외부 네트워크 `lci-prod_edge`에 붙으며 별칭은 `food-web`. DB/API는 음식점 전용 internal 네트워크에 둔다. 기존 LCI DB 및 서비스는 변경하지 않는다.

## 최초 실행 (PowerShell)
프로젝트 루트 `C:\dev\food`에서 실행한다. Docker Desktop이 켜져 있어야 한다.

```powershell
# 임의 비밀번호를 .env.deploy에 생성(이미 있으면 보존), SQLite 일관성 백업
backend/.venv/Scripts/python.exe backend/scripts/prepare_deployment.py
docker compose --env-file .env.deploy config --quiet
docker compose --env-file .env.deploy build
docker compose --env-file .env.deploy up -d food-db migrate
```

처음 데이터 이전은 **새 DB가 비어 있을 때 한 번만** 실행한다. 백업 경로는 위 출력에서 확인한다. 비밀번호/DB 내용은 문서나 터미널 출력에 붙이지 않는다.

```powershell
$foodBackup = 'C:\dev\food\.deploy\sqlite-before-docker-YYYYMMDD-HHMMSS.db'
docker compose --env-file .env.deploy run --rm --no-deps --volume "${foodBackup}:/backup/source.db:ro" backend python -m scripts.import_sqlite /backup/source.db
docker compose --env-file .env.deploy up -d --wait
```

이전 스크립트는 원본을 읽기 전용으로 열고 UUID·FK·숫자·시각·이력을 유지한다. 기존 target 데이터가 있으면 중단하며 삽입 실패 시 전체 트랜잭션을 롤백한다. Alembic 버전은 새 DB의 migration으로 관리한다. `.env.deploy`, `.deploy/`는 git 및 이미지 빌드에서 제외한다.

이전 뒤에는 기존 개발 서버(SQLite)에 입력하지 않고 새 배포 주소만 사용한다. 두 DB는 자동 동기화되지 않는다. 이전 후 재차 가져오기로 합치지 말고 별도 검토한다.

## 주소와 데이터
- 로컬: `http://localhost:8088/food/`
- 배포 목표: `https://lci.leejblab.site/food/`
- 화면: `/food/home`, `/food/menus`, `/food/ingredients`, `/food/inventory`, `/food/analytics`, `/food/settings`.
- 공통 `?store=<UUID>`를 모든 화면 링크에 유지한다. 존재하지 않는 매장은 오류로 표시하며 다른 매장으로 조용히 변경하지 않는다.
- 메뉴: `q`, `category`, `status`; 식자재: `q`, `status`; 재고: `ingredient`, `tab=RECEIPT|COUNT|ADJUST`는 URL에 유지되어 새로고침/뒤로 가기/주소 공유 시 복원된다.
- 저장을 완료한 업무 데이터는 공통 PostgreSQL에 영구 저장된다. 저장 전 입력/열린 모달/단가 시뮬레이션은 자동 저장 대상이 아니다.
- 정적 파일은 Vite base `/food/`, API는 `/food/api/v1`, Nginx는 `/food`를 제거해 API에 전달한다.
- API 응답과 HTML은 캐시하지 않는다. 해시 이름 정적 파일만 장기 캐시한다.

## Cloudflare 적용 (로컬 검증 후)
`lci-prod` → Routes → Published application. 새 규칙을 기존 전체 호스트 규칙보다 위로 배치한다.

| 우선순위 | 호스트 | 경로 | 서비스 |
|---|---|---|---|
| 1 | lci.leejblab.site | `^/food(/.*)?$` | `http://food-web:80` |
| 2 | lci.leejblab.site | 기존 전체 경로 | `http://nginx:80` (기존 값 유지) |

DNS 레코드는 변경하지 않는다. `food-web`은 컨테이너에서만 해석되는 이름으로, 터널과 같은 `lci-prod_edge`에 있어야 한다.

**현재 데모의 공개 정책(U-14, 2026-10-31):** 사용자가 지인 소개용 프로토타입이므로 로그인을 생략한다고 명시하여, 이번 `/food`는 Cloudflare Access 없이 공개한다. 링크를 아는 사람은 같은 데모 데이터를 조회·수정할 수 있다. 기존 LCI의 인증·보안 설정은 변경하지 않는다. 실제 매장 운영/민감 데이터 사용 전 `/food`와 하위 API 전체를 보호하는 인증을 도입한다. 이전의 공개 전 Access 제안(P-14)은 이번 데모에 한해 사용자 지시로 대체되었다.

## 업데이트 / 중지 / 보존
```powershell
docker compose --env-file .env.deploy up -d --build --wait
docker compose --env-file .env.deploy ps
docker compose --env-file .env.deploy logs --tail 50 backend
docker compose --env-file .env.deploy stop
docker compose --env-file .env.deploy start
```

이 명령들은 `food_pgdata` 볼륨을 유지한다. `down -v` 또는 볼륨 삭제는 데이터를 지우므로 사용하지 않는다. `.env.deploy`의 DB 비밀번호는 DB 초기화 이후 임의로 변경하지 않는다.

DB 백업은 `pg_dump -Fc` 형식으로 별도 보관한다. Windows PowerShell 5의 바이너리 리다이렉션 손상을 피하려면 컨테이너 파일로 dump하고 `docker cp`로 꺼낸다.

```powershell
docker compose --env-file .env.deploy exec -T food-db pg_dump -U food -d food -Fc -f /tmp/food-backup.dump
$foodDbContainer = docker compose --env-file .env.deploy ps -q food-db
docker cp "${foodDbContainer}:/tmp/food-backup.dump" '.deploy/food-backup.dump'
```

Windows 부팅 후 Docker Desktop 시작, 절전 방지, 인터넷 연결, 기존 lci 터널의 실행이 모두 필요하다. PC/회선의 처리 용량은 별도 부하 테스트 전 미검증. Nginx 업로드 제한은 요청당 20MB이며 Cloudflare의 별도 제한도 적용된다. POS A/B 실연동은 미검증.
