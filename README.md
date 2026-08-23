# 귀엽기만 해도 되나요? 🐶

> 집 안을 돌아다니는 강아지에게 간식을 주고 쓰다듬으면, 마지막에 실제 사진을 만나는 Apps in Toss 미니앱입니다.

작고 귀여운 상호작용 하나로 잠깐 웃을 수 있는 경험을 목표로 합니다. 첫 만남은 무료이며, 이후에는 리워드 광고 또는 반려견 사진 등록을 통해 새로운 친구를 더 만날 수 있습니다.

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
- 일일 이용 규칙: 무료 1회, 리워드 광고 3회, 사진 등록 보너스 1회
- 반려견 등록: 사진 선택, 특징 확인, 동의 및 검수 요청 흐름
- Apps in Toss 대응: TDS Mobile, 사진 권한, 익명 사용자 키, 전면형 리워드 광고
- 일반 브라우저 대응: 샘플 데이터, 파일 선택기, 광고 성공 시뮬레이션으로 전체 UX 테스트 가능

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

브라우저에서 `http://localhost:5173`을 열어 확인합니다. 환경변수를 넣지 않으면 별도 서버 없이 샘플 강아지와 브라우저용 대체 기능으로 전체 흐름이 동작합니다.

## 환경변수

실제 백엔드나 광고 그룹을 연결할 때만 필요합니다. `.env.example`을 `.env.local`로 복사한 뒤 값을 입력하세요.

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_REWARDED_AD_GROUP_ID=ait-ad-test-rewarded-id
```

| 이름 | 설명 | 미설정 시 동작 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL | 샘플 강아지 사용 |
| `VITE_SUPABASE_ANON_KEY` | Supabase 공개 anon key | 샘플 강아지 사용 |
| `VITE_REWARDED_AD_GROUP_ID` | 앱인토스 리워드 광고 그룹 ID | 공식 테스트 ID 사용 |

`.env`, `.env.local`, `.vercel`과 빌드 결과물은 Git에 포함되지 않습니다.

## 자주 쓰는 명령어

| 명령어 | 용도 |
| --- | --- |
| `npm run dev` | 로컬 개발 서버 실행 |
| `npm run typecheck` | TypeScript 검사 |
| `npm test` | 단위 테스트 실행 |
| `npm run build:web` | 일반 웹/Vercel용 `dist` 빌드 |
| `npm run build` | Apps in Toss용 `.ait` 번들 생성 |

## Vercel 배포

`vercel.json`에 Vite 배포 설정이 포함되어 있습니다.

```bash
npx vercel          # 미리보기 배포
npx vercel --prod   # 운영 주소로 배포
```

Vercel 웹 버전에서는 앱의 전체 UI와 제스처를 테스트할 수 있습니다. 토스 전용 광고 API는 실제 광고 대신 짧은 성공 시뮬레이션으로 동작합니다.

## Apps in Toss 테스트 및 빌드

1. `apps-in-toss.config.ts`의 `appName`이 콘솔에 등록된 고유 ID와 같은지 확인합니다.
2. 콘솔 권한과 설정 파일의 `photos: read` 권한을 동일하게 맞춥니다.
3. 리워드 광고 그룹 ID를 환경변수로 연결합니다.
4. 아래 명령으로 `.ait` 파일을 생성합니다.

```bash
npm run build
```

5. 앱인토스 콘솔의 **앱 출시 → 번들 업로드 → 테스트하기**에서 QR 코드를 생성합니다.

일반 브라우저나 Vercel에서는 토스 앱 브릿지의 실제 결과를 검증할 수 없습니다. 실제 광고 보상, 사진 권한, 사용자 식별키는 반드시 샌드박스와 토스 앱 QR 환경에서 최종 확인해야 합니다.

## Supabase 연결

`supabase/migrations`를 적용한 뒤 `pet-api`, `analyze-pet` Edge Function을 배포합니다. Edge Function에는 아래 비밀값이 필요합니다.

```text
OPENAI_API_KEY=...
USER_HASH_SALT=충분히_긴_무작위_문자열
ANALYSIS_SIGNING_SECRET=32자_이상의_별도_무작위_문자열
```

사진은 공개 URL로 저장하지 않습니다. 클라이언트가 Storage에 직접 접근하는 정책도 사용하지 않으며, 승인된 사진은 Edge Function이 발급하는 짧은 만료 시간의 서명 URL로만 제공합니다.

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
├─ functions/     사진 분석 및 앱 API Edge Function
└─ migrations/    테이블, 정책, Storage 설정
public/
└─ pet-artwork/   추가 캐릭터 이미지
```

## 현재 확인할 점

- 고양이는 후속 범위이며 현재는 강아지만 제공합니다.
- 실제 사용자 데이터 운영 전 사진 검수 관리자 화면과 삭제 요청 절차가 필요합니다.
- 운영 배포 전 접근성, 저사양 기기, iOS/Android 토스 앱 QR 테스트를 각각 진행해야 합니다.
- Unsplash 샘플 사진은 개발 시연용이며 운영 콘텐츠로 사용하기 전 라이선스와 출처 정책을 다시 확인해야 합니다.

## 참고 문서

- [Apps in Toss 개발자센터](https://developers-apps-in-toss.toss.im/)
- [Apps in Toss 예제 저장소](https://github.com/toss/apps-in-toss-examples)
- [Toss Design System](https://tossmini-docs.toss.im/tds-mobile/)
- [Vercel Vite 배포 문서](https://vercel.com/docs/frameworks/frontend/vite)

---

오늘 한 번의 귀여움으로 충분하도록. 🐾
