# 앨범 초기 배포 기록 — 2026-09-05

> 당시의 후보·설정 기록입니다. 현재 상태나 실행 지시가 아닙니다. [현행 앨범 설계](../architecture/ALBUM_AND_FAVORITES.md)와 [운영 안내](../operations/APPS_IN_TOSS_RELEASE.md)를 따릅니다.

## 당시 후보 — 2026-09-05 albumVersion 2 · 보상 OFF

- `20260905000700_daily_photo_collection.sql` 단독 적용과 `pet-api` 배포 완료. 기존 승인 7마리·대기 6마리·활성 사진 18장·사진 권한 100건·마음에 담기 1건을 보존했습니다.
- Toss 테스트 버전 **20260905-23**, SDK 3.1.1, production 런타임. [휴대폰 테스트 QR](https://apps-in-toss.toss.im/workspace/17687/mini-app/cute-enough/app-build?testDeploymentId=01a071ce-82ca-7ac5-b1ab-0342a0259a33&testVersionName=20260905-23).
- 파일: `TO_UPLOAD/cute-enough_20260905_ticket-album-v2_OFF_01a071ce-82ca-7ac5-b1ab-0342a0259a33.ait`, **1,673,641 bytes**.
- SHA-256: `5E517348BE2BD7DA420C415294184B6915B44F86FCED0DF33FD3DC9BD81E0B5C`.
- 소스 HEAD: `a20041e5334bc8d57e41a18d72388f62b56f754b` + 미커밋 변경. 빌드 당시 작업 트리 식별값: `2674b74d0f115f8ca6353c1295639412abb54dac86e09111f32341e69cfe9045`. 절대 경로·해시 계산 기준·기능 플래그는 같은 폴더의 `cute-enough_20260905_ticket-album-v2_OFF.release.json`에 기록했습니다.
- 검증: 앱·API 528개, PostgreSQL 57개, 검수 서버 12개, 운영 준비 스크립트 4개 통과. 타입 검사·웹·production AIT 빌드 통과. 초기 production JS 약 442.47KB gzip의 크기 경고는 남아 있습니다.
- **파일 생성 → 테스트 업로드 → QR 열기 완료. 실기기 검수 → 검토 요청 → 일반 사용자 출시는 미진행**입니다. 현재 라이브 `20260903-21`은 변경하지 않았습니다. 광고·보상·공유 보상·알림 운영 스위치와 비밀값은 변경하지 않았으며 활성화 후보는 담당 작업에서 별도로 만듭니다.

## 이전 후보 기록 — 2026-09-05 albumVersion 1 (현재 UI 아님)

- Supabase `xoqjehiqbaxpalbghngm`: `20260905000600` 마이그레이션 단독 적용 및 `pet-api` 배포 완료.
- 기존 승인 7마리·대기 6마리·활성 사진 18장 유지. 대표 사진 선물 권한 100건, 잘못 연결된 사진 권한 0건 확인.
- Toss Origin 4종 OPTIONS 204, 외부 Origin·null 403, 잘못된 익명키 401 확인. 새 RPC는 service-role 전용.
- production 번들 ID: `01a0717b-de37-7558-a0b7-464ad7207d23`. 광고 비활성 설정을 유지하며 개발 도구는 제외.
- 파일: `TO_UPLOAD/cute-enough_20260905_album-favorites_01a0717b-de37-7558-a0b7-464ad7207d23.ait` (배포 산출물이므로 Git에서 제외).
- Toss 콘솔 테스트 버전 `20260905-22` 등록 완료. [테스트 QR](https://apps-in-toss.toss.im/workspace/17687/mini-app/cute-enough/app-build?testDeploymentId=01a0717b-de37-7558-a0b7-464ad7207d23&testVersionName=20260905-22)을 열고 실제 사용자 A/B 검증 후 검토를 요청합니다. 일반 사용자용 출시 전환은 아직 하지 않았습니다.
- 검증: 앱·API 484개, PostgreSQL 42개, 검수 서버 12개, 운영 준비 스크립트 4개 테스트 통과. 타입 검사·웹 및 production AIT 빌드 통과. 360×640 로컬 UI에서 첫 공개→단골→앨범 재열람→다른 사진 공개→새로고침 기록 유지를 확인했습니다. 초기 JS는 약 440KB gzip으로 번들 크기 경고가 남아 있습니다.
