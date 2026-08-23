# 오늘의 강아지 🐶

> 집 안을 돌아다니는 강아지에게 간식을 주고 쓰다듬으면, 마지막에 실제 사진을 만나는 Apps in Toss 미니앱입니다.

작고 귀여운 상호작용 하나로 잠깐 웃을 수 있는 경험을 목표로 합니다. 첫 만남은 무료이며, 광고 승인이 완료된 운영 환경에서는 리워드 광고로 두 친구를 더 만날 수 있습니다. 반려견 사진을 등록한 날에는 본인이 올린 강아지와 한 번 무료로 놀 수 있습니다.

## 바로 체험하기

### [웹 데모 열기 → cute-enough.vercel.app](https://cute-enough.vercel.app)

웹 데모는 설치 없이 드래그, 간식 주기, 쓰다듬기, 샘플 사진 공개와 업로드 화면을 확인하는 시각 검수용입니다. 운영 Supabase와 광고는 연결하지 않습니다. 실제 토스 광고·사진 권한·사용자 식별키는 앱인토스 QR 테스트에서만 확인합니다.

## 어떤 경험인가요?

1. 집 안을 돌아다니는 강아지를 끌어 옮기거나 선택합니다.
2. 고구마·개껌·고기 중 하나를 골라 강아지에게 끌어다 줍니다.
3. 간식을 먹고 행복해진 강아지를 세 번 살살 쓰다듬습니다.
4. 일러스트 뒤에 숨겨진 실제 강아지 사진을 확인합니다.

드래그가 어려운 사용자는 간식을 선택한 뒤 강아지를 눌러도 같은 흐름을 이용할 수 있습니다.

## 주요 기능

- 강아지 자유 이동: Pointer Events 기반의 모바일·마우스 드래그
- 감정 표현: 헥헥거리는 혀, 빠르게 흔드는 꼬리, 간식 반응과 행복 애니메이션
- 간식 상호작용: 고구마·개껌·고기 3종과 드래그/터치 대체 동작
- 쓰다듬기 상호작용: 세 번의 터치 또는 짧은 스와이프로 사진 공개
- 자체 합성 효과음: 외부 음원 없이 강아지의 짧은 짖음·헥헥거림과 간식·쓰다듬기·사진 공개 소리를 실시간 생성
- 일일 이용 규칙: 총 3회(무료 1회, 리워드 광고 2회), 그날 첫 사진 등록 강아지 전용 보너스 1회
- 반려견 등록: 사진 선택, 특징 확인, 동의 및 검수 요청 후 본인 집에 즉시 등장
- 친구 공유: 승인된 강아지는 실제 사진까지, 검수 중 강아지는 캐릭터만 보여주는 전용 딥링크
- Apps in Toss 대응: TDS Mobile, 사진 권한, 익명 사용자 키, 전면형 리워드 광고
- 일반 브라우저 대응: 샘플 데이터와 파일 선택기로 화면·제스처 확인 가능(광고는 비활성화)

효과음은 Web Audio API로 앱 실행 중 직접 합성합니다. 외부 녹음물이나 음원 샘플을 포함하지 않아 별도 음원 라이선스가 필요하지 않습니다.

## 기술 구성

| 영역 | 사용 기술 |
| --- | --- |
| UI | React 18, TypeScript, Toss Design System Mobile |
| 빌드 | Vite 6, Apps in Toss Web Framework |
| 데이터 | Supabase Database, Storage, Edge Functions |
| 검증 | Vitest, Testing Library, TypeScript |
| 배포 | Apps in Toss `.ait`, Vercel 정적 배포 |

## 빠르게 실행하기

필요한 환경은 Node.js와 npm입니다.

```bash
git clone https://github.com/swaan-kim/cute-enough.git
cd cute-enough
npm ci
npm run dev
```

브라우저에서 `http://localhost:5173`을 열어 확인합니다. 기본 `preview` 모드는 별도 서버 없이 샘플 강아지를 사용하며 광고 기능을 숨깁니다.

## 환경변수

미리보기 기본값은 `.env.example`, 비공개 QR·운영 빌드 예시는 `.env.production.example`에 있습니다. 운영 비밀값은 저장소에 커밋하지 않습니다.

```env
VITE_APP_RUNTIME=preview
VITE_ADS_ENABLED=false
VITE_REWARDED_AD_GROUP_ID=
VITE_SHARE_OG_URL=
```

| 이름 | 설명 | 미설정 시 동작 |
| --- | --- | --- |
| `VITE_APP_RUNTIME` | `preview`, `private`, `production` | `preview` |
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL | private/production 빌드 실패 |
| `VITE_SUPABASE_ANON_KEY` | Supabase 공개 anon key | private/production 빌드 실패 |
| `VITE_ADS_ENABLED` | 광고 승인 후에만 `true` | 광고 숨김 |
| `VITE_REWARDED_AD_GROUP_ID` | 승인된 실광고 그룹 ID | 광고가 켜진 빌드 실패 |
| `VITE_SHARE_OG_URL` | 영구 공개 저장소의 1200×600 OG | private/production 빌드 실패 |

`.env`, `.env.local`, `.vercel`과 빌드 결과물은 Git에 포함되지 않습니다.

## 자주 쓰는 명령어

| 명령어 | 용도 |
| --- | --- |
| `npm run dev` | 로컬 개발 서버 실행 |
| `npm run typecheck` | TypeScript 검사 |
| `npm test` | 단위 테스트 실행 |
| `npm run build:web` | 일반 웹/Vercel용 `dist` 빌드 |
| `npm run build` | preview용 Apps in Toss `.ait` 생성 |
| `npm run build:private` | 비공개 QR용 `.ait` 생성(운영 설정 필수) |
| `npm run build:production` | 제출용 `.ait` 생성(운영 설정 필수) |

## Vercel 배포

`vercel.json`에 Vite 배포 설정이 포함되어 있습니다.

```bash
npx vercel          # 미리보기 배포
npx vercel --prod   # 운영 주소로 배포
```

Vercel은 샘플 데이터 기반 화면 확인용입니다. 운영 Supabase 키를 연결하지 않으며 토스 전용 광고는 숨깁니다. Vercel 결과를 앱인토스 제출 검수 근거로 사용하지 않습니다.

## Apps in Toss 테스트 및 빌드

1. `apps-in-toss.config.ts`의 `appName`이 콘솔에 등록된 고유 ID와 같은지 확인합니다.
2. 콘솔 권한과 설정 파일의 `photos: read` 권한을 동일하게 맞춥니다.
3. 광고 승인이 완료되기 전에는 광고 플래그를 끕니다. 승인 후에만 실광고 그룹 ID를 연결합니다.
4. 아래 명령으로 `.ait` 파일을 생성합니다.

```bash
npm run build:private
```

5. 앱인토스 콘솔의 **앱 출시 → 번들 업로드 → 테스트하기**에서 QR 코드를 생성합니다.

일반 브라우저나 Vercel에서는 토스 앱 브릿지의 실제 결과를 검증할 수 없습니다. 실제 광고 보상, 사진 권한, 사용자 식별키는 반드시 샌드박스와 토스 앱 QR 환경에서 최종 확인해야 합니다.

## Supabase 연결

`supabase/migrations`를 적용한 뒤 `pet-api` Edge Function을 배포합니다. 사진은 브라우저에서 최대 1024px JPEG로 다시 만들어 EXIF를 제거하고 털색만 로컬에서 제안하므로 OpenAI API나 유료 이미지 분석 키가 필요하지 않습니다. 기존에 `analyze-pet`을 배포했다면 운영 프로젝트에서 해당 Function을 제거합니다.

운영 Edge Function에는 아래 비밀값이 필요합니다. mTLS 인증서와 개인 키는 앱인토스 콘솔에서 발급한 PEM 원문이며, 절대로 `VITE_` 환경 변수나 클라이언트 번들에 넣지 않습니다.

```text
AIT_RUNTIME_ENV=production
AIT_MTLS_CERT_PEM=-----BEGIN CERTIFICATE----- ...
AIT_MTLS_PRIVATE_KEY_PEM=-----BEGIN PRIVATE KEY----- ...
USER_HASH_SALT=충분히_긴_무작위_문자열
```

로컬 Edge Function에서만 `AIT_RUNTIME_ENV=local`, `AIT_ALLOW_UNVERIFIED_ANON_KEY=true`를 사용할 수 있습니다. 운영에서는 이 우회 설정이 작동하지 않으며, 익명키 검증이나 요청 빈도 확인을 수행할 수 없으면 API가 안전하게 실패합니다.

사진은 공개 URL로 저장하지 않습니다. 클라이언트가 Storage에 직접 접근하는 정책도 사용하지 않으며, 승인된 사진은 Edge Function이 발급하는 짧은 만료 시간의 서명 URL로만 제공합니다.

업로드한 강아지는 검수 전에도 업로더 본인의 집에 나타나며, 그 강아지에 묶인 당일 보너스로 한 번 만날 수 있습니다. 검수 중 공유 링크를 받은 사람에게는 캐릭터만 보이고 원본 사진은 노출되지 않습니다. 승인된 뒤에만 실제 사진을 만날 수 있습니다. `202608240002_upload_rewards_and_sharing.sql` 이전의 기존 업로드에는 보상이 소급 적용되지 않습니다.

## 캐릭터 이미지 추가

새 캐릭터 이미지는 투명 배경 WebP 또는 PNG를 권장합니다.

1. 이미지를 `public/pet-artwork`에 추가합니다.
2. `src/data/petArtwork.ts`의 `PET_ARTWORK`에 반려견 ID와 경로를 연결합니다.

연결된 이미지가 없으면 사진에서 추출된 특징 조합을 바탕으로 SVG 강아지가 자동 표시됩니다.

## 프로젝트 구조

```text
src/
├─ components/    화면과 상호작용 컴포넌트
├─ data/          샘플 강아지와 캐릭터 이미지 연결
├─ lib/           이용 횟수, 토스 브릿지, Supabase API
└─ types.ts       공용 데이터 타입
supabase/
├─ functions/     익명키 검증·업로드·공유 앱 API Edge Function
└─ migrations/    테이블, 정책, Storage 설정
public/
└─ pet-artwork/   추가 캐릭터 이미지
```

## 현재 확인할 점

- 고양이는 후속 범위이며 현재는 강아지만 제공합니다.
- 검수 관리자 UI는 이번 제출 범위 밖이며 운영자가 DB·Storage에서 검수합니다. 삭제는 앱인토스 `⋯ > 문의하기` 요청을 받아 즉시 비공개·원본 삭제합니다.
- 운영 배포 전 접근성, 저사양 기기, iOS/Android 토스 앱 QR 테스트를 각각 진행해야 합니다.
- Unsplash 샘플 사진은 개발 시연용이며 운영 콘텐츠로 사용하기 전 라이선스와 출처 정책을 다시 확인해야 합니다.

## 참고 문서

- [Apps in Toss 개발자센터](https://developers-apps-in-toss.toss.im/)
- [Apps in Toss 예제 저장소](https://github.com/toss/apps-in-toss-examples)
- [Toss Design System](https://tossmini-docs.toss.im/tds-mobile/)
- [Vercel Vite 배포 문서](https://vercel.com/docs/frameworks/frontend/vite)

---

오늘 한 번의 귀여움으로 충분하도록. 🐾
