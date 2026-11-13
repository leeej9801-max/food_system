---
id: ADR-016
type: adr
status: ACCEPTED
created: 2026-11-11
updated: 2026-11-11
source_of_truth: true
related_decisions: [ADR-013]
related:
  - "[[ARCH-REVIEW-fable-20261111]]"
  - "[[WO-20261110-002_lee-start_표준정렬_리팩토링]]"
tags: [adr, db, uuid]
---

# ADR-016 — ID는 PostgreSQL `uuid` 타입, 값은 앱이 만드는 UUID v7

## 상태
확정. 2026-11-11 통합 지시 2번(리뷰 3.6, 리팩토링 ⑤). 인증 테이블을 만들기 전에 끝낸다.

## 결정
- 모든 PK·FK 컬럼을 `varchar(36)`에서 PostgreSQL `uuid`로 바꾼다. 52개 컬럼. `holidays`는 날짜가 PK라 해당 없다.
- 값은 앱이 UUID v7로 만든다: `backend/app/db/models/__init__.py`의 `new_uuid()`.
- 파이썬 코드에서 ID는 `str`이 아니라 `uuid.UUID`다. 경로·쿼리·요청 본문의 ID는 FastAPI가 형식을 검사한다.
- RLS 정책은 `uuid = uuid` 비교다. `app_current_store_id()`가 `uuid`를 돌려준다. `app_resolve_table_qr()`도 `uuid` 두 개를 돌려준다.
- 마이그레이션 0001~0007을 **고쳐 썼다**(새 리비전 추가가 아님). 지금 데이터는 전부 임시라고 사용자가 확인했다.

## v7을 앱에서 만드는 근거 (공식 문서, 2026-11-11 확인)
| 대상 | 문서 | 내용 |
|---|---|---|
| PostgreSQL 17 | https://www.postgresql.org/docs/17/functions-uuid.html | "PostgreSQL includes one function to generate a UUID: `gen_random_uuid`" (v4). `uuidv7`은 없다 |
| PostgreSQL 18 | https://www.postgresql.org/docs/18/functions-uuid.html | `uuidv7 ( [ shift interval ] ) → uuid`, "Generates a version 7 (time-ordered) UUID" |
| Python 3.12 | https://docs.python.org/3.12/library/uuid.html | `uuid1`, `uuid3`, `uuid4`, `uuid5`만 있다. `uuid7`은 없다 |
| Python 3.14 | https://docs.python.org/3.14/library/uuid.html | `uuid.uuid7()`, "Added in version 3.14" |

운영은 PostgreSQL 17 + Python 3.12라 둘 다 v7 생성 함수가 없다. 그래서 `new_uuid()` 10줄로 만든다. 의존성은 추가하지 않았다.

- 구조(RFC 9562 5.7): 앞 48비트 = Unix ms 시각, 버전 4비트 = 7, 변형 2비트 = `10`, 나머지 74비트 = `secrets` 난수.
- 한계: 같은 ms 안에서 만든 값끼리는 순서가 보장되지 않는다. 정렬은 지금처럼 `created_at`으로 한다. ID 순서에 기대는 코드는 없다.
- 바꿀 때: Python 3.14 이상으로 올리면 `uuid.uuid7()`로 교체한다. PostgreSQL 18로 올려도 앱 생성을 유지한다(INSERT 전에 ID를 알아야 하는 코드가 있다).
- 검사: `backend/tests/test_ids.py`.

## 바뀐 동작
- 형식이 틀린 ID(예: `/stores/abc/menus`)는 이제 **422 `VALIDATION_ERROR`**다. 전에는 문자열 비교라 404였다. 형식은 맞고 없는 ID는 그대로 404다.
- JSON 응답의 ID는 전과 같은 문자열이다. 프론트 코드는 바뀌지 않았다. OpenAPI에는 `format: uuid`가 붙었다(스냅샷 갱신).
- 새로 만든 ID는 `01…`처럼 시각 순으로 시작한다.

## 운영 DB 초기화 절차 (문서만. 이번에 실행하지 않았다)
리비전 이름은 그대로 두고 내용만 고쳤다. 운영 DB는 이미 `0008`이라 **`alembic upgrade head`가 아무것도 하지 않는다.** 컬럼은 `varchar`로 남고 새 코드와 맞지 않아 요청이 실패한다. 그래서 새 이미지를 올리기 전에 DB를 비우고 다시 만들어야 한다.

**기존 데이터는 전부 사라진다.** 실데이터가 하나라도 들어갔다면 이 절차를 쓰지 않는다. 그 경우 컬럼을 `ALTER ... TYPE uuid USING id::uuid`로 바꾸는 마이그레이션을 따로 써야 한다(이번에 만들지 않았다).

순서(저장소 루트, PowerShell):
1. 백업을 남긴다. `deploy/README.md`의 `pg_dump -Fc` + `docker cp` 절차.
2. 앱을 멈춘다: `docker compose --env-file .env.deploy stop backend web`
3. DB를 비운다(소유자 계정). `public` 스키마를 지우고 다시 만든다:
   `docker compose --env-file .env.deploy exec -T food-db psql -U food -d food -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`
4. 새 이미지를 빌드하고 `migrate` 서비스를 돌린다. `alembic upgrade head`와 `ensure_runtime_role`이 다시 실행된다.
5. `backend`, `web`을 올린다.
6. 확인: `\d stores`에서 `id`가 `uuid`인지, 매장을 하나 만들어 ID가 `01`로 시작하는지 본다.
7. 테이블 QR을 다시 발급한다. 토큰이 지워졌으므로 인쇄한 QR은 더 이상 동작하지 않는다.

되돌리기: 이전 이미지로 내리고 1번 백업을 `pg_restore`한다.

## 확인하지 못한 것
- 위 절차를 실제 운영 DB나 그 복사본에서 돌려 보지 않았다. `미검증`.
- 3번의 `DROP SCHEMA` 뒤 `food_app` 역할의 권한이 `ensure_runtime_role`로 전부 복구되는지는 CI의 빈 DB 경로로만 확인했다.
- `backend/scripts/import_sqlite.py`(예전 SQLite 이전용)는 ID가 UUID 형식일 때만 동작한다. 실제 예전 SQLite 파일로 다시 돌려 보지 않았다. 이전은 이미 끝났다.
- 인덱스 크기·삽입 속도 차이는 측정하지 않았다.
