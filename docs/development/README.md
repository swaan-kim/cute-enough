# 개발 가이드

[문서 안내](../README.md) · [프로젝트 소개](../../README.md)

Node.js 24와 `npm ci`를 사용합니다. 일반 화면 확인은 `npm run dev`로 시작하며, 기본 preview는 로컬 샘플만 사용합니다. 브라우저 샘플은 실제 업로드·승인·광고를 검증하지 않습니다.

## 코드 위치

| 경로 | 책임 |
| --- | --- |
| `src/components` | 집·교감·사진·등록·앨범 화면 |
| `src/lib` | 사진 권한·티켓·요청·캐시·토스 SDK 연결 |
| `src/design`, `src/review` | 공용 SVG 문서와 로컬 검수 화면 |
| `src/data`, `src/web-preview` | 운영과 분리된 샘플·일반 브라우저 UI |
| `supabase/functions` | 인증·사진 URL·수집·보상·알림 서버 |
| `supabase/migrations` | 변경 이력과 격리 SQL 회귀 테스트 |
| `tools/review-console` | 서버 전용 키를 사용하는 localhost 검수 서버 |
| `tests/e2e` | 정상 앱 화면의 모바일·두 사용자 여정 |
| `scripts` | 검증·빌드 잠금·AIT 보관 도구 |

UI와 정책을 나누되, 경로 정리를 위해 앱 코드를 불필요하게 이동하지 않습니다. 테스트는 구현 옆의 단위 테스트, 실제 SQL 테스트, 정상 화면 E2E로 구분합니다.

## 환경 분리

- `.env.example`: 샘플 앱 설정. 비밀값 없이 화면·제스처 확인.
- `.env.production.example`: private/production 빌드의 공개 설정. `VITE_`는 사용자에게 전달되므로 서버 비밀키를 넣지 않음.
- `.env.review.example`: 로컬 검수 서버 설정. 실제 값은 Git 제외 `.env.review.local`에만 저장.
- DB·Edge의 비밀값·mTLS 인증서·사용자 익명키는 프런트 번들과 Git에 넣지 않음.

샘플 상태는 `/?scenario=first-user`, `owner`, `complete`, `ads-off`에서 확인합니다. 공개 4마리와 내 최신 강아지 최대 1마리입니다. 사진 선택·광고·공유·알림의 실제 기기 동작은 Toss QR 검사로 구분합니다.

## 검증과 빌드

```sh
npm ci
npx playwright install chromium
npx deno cache --node-modules-dir=manual --config supabase/functions/deno.json supabase/functions/pet-api/index.ts
npm run docs:check
npm run test:flows
npm run build:web
```

설치 단계만 네트워크를 사용합니다. 실제 자동 검사는 운영 환경변수를 제거하고 외부 응답을 대체하며, Edge 테스트는 네트워크를 거부합니다. [QA 기준과 남은 경계](../quality/QA_STRATEGY.md)를 확인하세요. GitHub의 `Application quality`도 같은 명령을 실행하고, 운영 키·DB 적용·앱 업로드는 수행하지 않습니다.

AIT는 `npm run build:production` → `AIT/LATEST/cute-enough.ait` 및 `release.json`만 전달합니다. 테스트는 `build:private` 또는 `build:preview` → `AIT/TEST`입니다. `ait:check`로 해시를 대조하며, 빌드 잠금을 지우거나 SDK를 직접 실행하지 않습니다. 파일 생성은 업로드·출시와 다릅니다.

## 검수·데이터 보존

`npm run review` 후 `http://127.0.0.1:4178/review`를 엽니다. [검수 안내](../operations/REVIEW_CONSOLE.md)에 따라 초안과 최종 공개를 구분합니다. 예전 seed·승인 RPC·도감 초기화 명령을 현재 상태 확인용으로 실행하지 않습니다.

사진 제외는 `is_active` 변경으로 처리하며 원본·사진 ID·수집·감사 기록을 보존합니다. 적용된 마이그레이션은 수정하지 않고 후속 파일을 추가합니다. 실제 DB 적용·승인·배포는 해당 변경의 별도 확인 후 수행합니다.
