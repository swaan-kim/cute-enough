# 광고 ON · 서버 재배포 · AIT 업로드 결과

> 과거 구현·배포 기록입니다. 당시 상태·명령은 현재 운영 절차가 아닙니다. [문서 안내](../README.md)에서 현재 가이드를 확인하세요. 도감 초기화·승인·출시는 별도의 명시적 확인 없이 실행하지 않습니다.

2026-09-06 사용자가 광고 ON, 서버 재배포, AIT 업로드를 명시 요청했다. 요청 범위까지 완료했으며 **실기기 완료 판정·검토 요청·일반 사용자용 출시는 하지 않았다.**

## 적용 상태

- 광고 지면 `ait.v2.live.285b758f6d564708`: ENABLED, 보상형, 1 `강아지 티켓`, 제한 없음 확인.
- 앱 private/production 로컬 설정: 광고 ON, 위 실광고 ID, 테스트 모드 OFF.
- Edge `AIT_REWARDED_ADS_ENABLED=true` 한 항목만 변경했다. DB `pet_reward_settings.ads_enabled=true` 적용. 기존 `share_enabled=true`와 공유/알림 설정은 유지했다.
- `pet-api` 소스 v27 배포 후 비밀값 갱신으로 메타데이터 **v28 ACTIVE**. 실제 다운로드 런타임 23개가 로컬과 모두 바이트 단위 일치한다.
- 이전 live v26 대비 서버 차이는 공유 단위 `티켓` 호환과 완료 광고 보상의 앨범 소비 허용, 두 파일뿐이다. 신규 광고·소유자·세션·요청 ID·차감 검증은 유지한다.
- 알림 함수는 별도 배포하지 않았다. 프로젝트 비밀값 갱신으로 메타데이터 v4→v5가 됐지만 번들 해시와 소스는 동일하다.
- DB 마이그레이션이나 개별 강아지/사진 승인은 하지 않았다. 광고 스위치 트랜잭션에서 기존 강아지·사진·SVG·Storage·수집권·광고/공유 세션·보너스 및 나머지 설정의 해시 보존을 확인했다.

보존 해시: `41caab542c03c5f2b0129a4e443626b44bd2bafdf3f6563f3117100ad8f8175b`

서버 런타임 manifest SHA-256: `adb63d523b2a6c16270f2899efb966df9e00dc9459a091e436afb4514d698540`

서버 bundle SHA-256: `300007d74b41b077236ff380563ae4fa4463ac84162eda5bdb58aa494e2935c0`

알림 bundle SHA-256(변경 없음): `c1a225812a2afffa8499b3fdad502e8bcd6569fa65d202e4d56c01709220e249`

## AIT 두 버전

| 구분 | 실광고 ON 후보 | 테스트 광고 전용 — 출시 금지 |
| --- | --- | --- |
| 버전 | `20260906-28` | `20260906-27` |
| deploymentId | `01a075d6-3e65-75ba-bf5e-bf5ab14d5d67` | `01a075d6-07bf-75b9-8fca-c6a46cf22a3f` |
| runtime | production | private |
| 광고 / 테스트 모드 | ON / OFF | ON / ON |
| 광고 ID | `ait.v2.live.285b758f6d564708` | `ait-ad-test-rewarded-id` |
| 크기(bytes) | 2,707,584 | 2,707,547 |
| SHA-256 | `c3138472729cc5c97f4d3e80a1a0888005adaa4ea114e9e3daf930424f8db850` | `17efb9e4db7be29e504e4e76b251979b61bdcdc4c6e2a7c1bf09904610570ba8` |
| 업로드·컴파일 | HTTP 200 / CREATED | HTTP 200 / CREATED |
| 테스트 푸시 | 미발송 | 본인 발송 완료 |

파일:

- `.tmp/ad-on-release-20260906/cute-enough-ads-on-production.ait`
- `.tmp/ad-on-release-20260906/cute-enough-ads-qa-private.ait`

두 파일 공통 Node `v24.14.1`, 앱인토스 SDK `3.1.1`, 소스 커밋 `a20041e5334bc8d57e41a18d72388f62b56f754b`. 미커밋 작업 트리 식별값 `b75d2edef586fc445f966d9715df8ccd1a5e55f223773b6a67f1ab5aca24b67b`(추적 diff + 비무시 untracked 100개, 본 결과 문서 작성 전 2026-09-06T08:30:40Z 기준). 환경 파일은 비공개이며 식별값에는 포함하지 않고 위 플래그로 별도 기록한다. 기존 OFF AIT 보관본은 유지했다.

## 테스트 방법과 한계

- [테스트 광고 QR — 20260906-27](https://apps-in-toss.toss.im/workspace/17687/mini-app/67857/app-build?testDeploymentId=01a075d6-07bf-75b9-8fca-c6a46cf22a3f&testVersionName=20260906-27)
- 본인 휴대폰 딥링크: `intoss-private://cute-enough?_deploymentId=01a075d6-07bf-75b9-8fca-c6a46cf22a3f&host=appsInTossHost`
- 테스트 푸시의 `isTested=true`는 테스트 준비 상태이지 실제 완료가 아니다.
- 무료·보너스 티켓이 0일 때 미수집 강아지를 누르고 광고 선택 → 완료 후 기존 간식·쓰다듬기 → 사진을 확인한다. 취소·실패는 보상 없음, 같은 완료의 재시도는 중복 차감 없음, 자연 충전 타이머 유지, 하루 광고 최대 2회다.
- 광고 보상은 **선택한 강아지의 사진 접근권**이며 티켓 잔액 +1이 아니다. 개발 검증은 공식 테스트 광고로 진행한다. 실제 광고 노출/클릭·친구 초대·보상 지급을 자동 실행하지 않았다.
- [공식 광고 가이드](https://developers-apps-in-toss.toss.im/documentation/common/monetization/iaa/interstitial-rewarded-ad)에 맞춰 private + 명시적 테스트 모드에서만 정확한 테스트 ID를 허용했다. production에서는 테스트 ID/모드를 차단한다. QA 파일을 출시하지 않는다.
- 광고 로딩은 SDK의 최대 60초 지연을 고려해 제한을 65초로 늘렸다. 20초 뒤 로드 성공, 제한 초과 실패 및 정리 1회를 가상 시각으로 검증했다.
- 현재 일반 사용자 라이브는 여전히 `20260903-21` / `01a065f2-ec98-797c-aa9c-55143c1ed436`이다. 서버 설정은 운영에도 적용되지만 새 AIT 화면은 출시 전환 전까지 일반 사용자에게 전달되지 않는다.

## 자동 검증

- 전체 Vitest 97개 파일 / **942개 통과**.
- 빌드 설정 검사 22개, 실제 SQL 로컬 보상/앨범/하루 한 장 검사 64개, 실제 Edge 핸들러 로컬 검사 5단계 통과.
- 타입 검사, Deno 검사, private QA·production AIT 빌드 통과. 개발 도구 미포함 확인.
- 운영 4개 Toss Origin preflight 204 및 정확한 Origin 반환. null/file/유사 도메인 403, 잘못된 익명키 401.
- 초기 JS 약 456KB gzip 경고는 별도 성능 개선 항목이다.

장애 시 신규 광고만 중단하려면 Edge 광고 스위치와 DB `ads_enabled`만 false로 돌린다. 이미 완료한 보상, 공유 보상, 자연 충전, 사용자 기록을 삭제하거나 초기화하지 않는다. 본 작업에서 롤백은 실행하지 않았다.
