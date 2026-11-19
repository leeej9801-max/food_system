---
id: WO-20261117-003
type: work-order
status: DONE
created: 2026-11-17
updated: 2026-11-17
source_of_truth: false
related: ["[[현재_인수인계]]"]
---
# BaggleUp CI PNG 세트
사용자 요청: 기존 로고와 같은 정사각형 및 여러 크기의 CI 파일, 영문 철자 설명.
범위: design/baggleup-ci-v1 아래 PNG 가로형·정사각형·심볼과 ZIP, 사용 안내. 앱 적용·브랜드 확정·상표 조사·SVG 제외. 관련 REQ/S/ADR: 제품 코드 변경 없음, 해당 없음.
선행: 대화의 냄비 BaggleUp 원본. 정사각형은 imagegen 편집, 크기 출력은 Pillow.
수용 기준: BaggleUp 철자 유지, square 256/512/1024, horizontal 폭 512/1024/2048, icon 32/64/128/256/512/1024. PNG RGBA·크기·alpha 및 ZIP 무결성 검사, 육안 확인.
예상 파일: design/baggleup-ci-v1, WO/IR/REV, 허브·인수인계·변경이력.
위험/PROVISIONAL: 생성형 시안, 확대 시 디테일 한계, 상표·유사 로고 미검증.
완료: 저장·검사 결과 IR·self-review·인수인계 기록. [[개발_워크플로]] 참조.
