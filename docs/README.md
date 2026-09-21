# 문서 안내

처음 보는 사람은 [프로젝트 README](../README.md) → [개발 가이드](development/README.md) → [사용자·데이터 흐름](architecture/USER_FLOW.md) 순서로 읽으면 됩니다. 아래 문서는 로컬 소스 기준이며, 운영 적용 여부는 별도로 확인합니다.

| 폴더 | 읽을 때 | 시작 문서 |
| --- | --- | --- |
| `development` | 실행·환경 분리·코드 위치 확인 | [개발 가이드](development/README.md) |
| `architecture` | 등록·검수·사진·티켓의 책임 확인 | [사용자 흐름](architecture/USER_FLOW.md), [앨범·마음에 담기](architecture/ALBUM_AND_FAVORITES.md), [검수 SVG](architecture/REVIEW_SVG_DESIGN_20260906.md) |
| `operations` | 로컬 검수와 배포를 실제로 수행 | [검수 화면](operations/REVIEW_CONSOLE.md), [AIT 제출](operations/APPS_IN_TOSS_RELEASE.md), [충전 알림](operations/RECHARGE_NOTIFICATIONS.md) |
| `quality` | 검사 실행·한계·수정 근거 확인 | [QA 기준](quality/QA_STRATEGY.md), [서버부터 화면까지 개선 기록](quality/20260921-improvement-audit.md) |
| `history` | 예전 결정과 배포 후보의 근거 추적 | [과거 기록 읽는 법](history/README.md) |
| `screenshots` | README에서 쓰는 기존 화면 | [캡처 안내](screenshots/README.md) |

## 공개하지 않는 것

환경 비밀값·인증서·AIT 보관본·서명 URL·원본 사용자 사진은 문서에 추가하지 않습니다. `docs/marketing/`의 운영 원자료와 `src/review/designs/`의 미확정 개인 초안은 로컬에만 남깁니다. 정리 작업으로 원본을 지우거나 강아지를 승인하지 않습니다.

`npm run docs:check`로 공개 문서의 상대 링크를 검사합니다. 과거 문서의 도감 초기화·구형 승인 RPC·임시 AIT 경로는 현재 작업 지시가 아닙니다.
