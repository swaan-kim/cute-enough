# 옆집 강아지 🐶

> **귀엽기만 해도 되나요?** 집 안을 돌아다니는 강아지와 교감한 뒤 실제 사진을 만나는 Apps in Toss 미니앱입니다.

작고 귀여운 상호작용 하나로 잠깐 웃을 수 있는 경험을 목표로 합니다. 공개 강아지 4마리는 사용자별로 KST 하루 동안 고정되며, 자정이 지나면 새 조합으로 바뀝니다. 무료 이용권은 최대 2개까지 보관되고 사용 후 3시간마다 1개씩 충전됩니다. 이용권이 0개일 때는 광고 승인이 완료된 운영 환경에서 리워드 광고로 기다림을 건너뛸 수 있습니다(하루 최대 2회). 본인이 가장 최근에 올린 `pending | approved` 강아지가 있으면 오늘의 진행도와 별개인 다섯 번째 보너스 친구로 표시되며 언제든 사진을 볼 수 있습니다.

## 바로 체험하기

### [웹 데모 열기 → cute-enough.vercel.app](https://cute-enough.vercel.app) (구 버전)

웹 데모는 설치 없이 드래그, 간식 주기, 쓰다듬기, 샘플 사진 공개와 업로드 화면을 확인하는 시각 검수용입니다. 운영 Supabase와 광고는 연결하지 않습니다. 실제 토스 광고·사진 권한·사용자 식별키는 앱인토스 QR 테스트에서만 확인합니다.

## 어떤 경험인가요?

1. 집 안을 돌아다니는 강아지를 끌어 옮기거나 선택합니다.
2. 고구마·개껌·고기 중 하나를 골라 강아지에게 끌어다 줍니다.
3. 간식을 먹고 행복해진 강아지를 세 번 살살 쓰다듬습니다.
4. 일러스트 뒤에 숨겨진 실제 강아지 사진을 확인합니다.

이 과정은 처음 만나는 공개 강아지에만 적용됩니다. 본인이 올린 강아지와 재열람 가능한 강아지는 누르면 사진창이 먼저 열리고, 사진을 불러오는 동안 스켈레톤과 재시도 UI를 보여줍니다. 드래그가 어려운 사용자는 간식을 선택한 뒤 강아지를 눌러도 같은 흐름을 이용할 수 있습니다.

## 주요 기능

- 강아지 자유 이동: Pointer Events 기반의 모바일·마우스 드래그
- 감정 표현: 헥헥거리는 혀, 빠르게 흔드는 꼬리, 간식 반응과 행복 애니메이션
- 간식 상호작용: 고구마·개껌·고기 3종과 드래그/터치 대체 동작
- 쓰다듬기 상호작용: 세 번의 터치 또는 짧은 스와이프로 사진 공개
- 자체 합성 효과음: 외부 음원 없이 강아지의 짧은 짖음·헥헥거림과 간식·쓰다듬기·사진 공개 소리를 실시간 생성
- 이용 규칙: 무료 이용권 최대 2개, 사용 후 3시간마다 1개 충전, 이용권이 0개일 때만 리워드 광고로 즉시 한 친구 만나기(하루 최대 2회)
- 오늘의 집: 사용자·KST 날짜별 공개견 4개 슬롯을 저장해 같은 날에는 순서와 구성을 유지하고 자정에만 새로 선정
- 내 강아지 보너스: 가장 최근의 `pending | approved` 강아지가 있으면 공개 4마리와 중복되지 않는 소파 전용 다섯 번째 친구로 표시하며 이용권·광고·`4/4` 진행도에서 제외
- 공개 후보 부족 대응: 강아지를 복제하지 않고 빈 슬롯에 `새 친구를 기다리고 있어요`를 표시하며, 정상 운영 전 활성 실사 사진이 있는 승인견 8마리 이상 확보
- 다시 보기: 공개 강아지는 다음 이용권 충전 시각까지 무차감으로 바로 열고, 내 `pending`·`approved` 강아지는 언제든 무료로 열기
- 승인 반영: 공유 링크에는 즉시 반영하고 다른 사용자의 집에는 다음 KST 날짜부터 후보로 편입
- 반려견 등록: `사진 → 이름·기본 모습 → 더 닮게 꾸미기(선택) → 동의·등록` 흐름으로 제출
- 꾸미기 미리보기: 190px 미리보기가 스크롤 뒤 92px 상단 카드로 줄어 귀·털색·무늬·소품 변경을 계속 확인
- 캐릭터 소품: 리본핀·스카프·조끼·애착 공과 4가지 색상, 사용자 확정 또는 검수자 위임
- 내부 검수: 실사·64/114/190px 캐릭터·유사 강아지를 비교하고 최종 형태·털·표정·소품을 승인하며, 승인견 검색·보정·공개 중지도 지원
- 친구 공유: 승인된 강아지는 실제 사진까지, 검수 중 강아지는 캐릭터만 보여주는 전용 딥링크
- 사진 저장: 실제 사진에 작은 분홍 로고와 해당 강아지 이름표를 합성한 JPG 복사본만 사용자 기기에 저장
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

핵심 홈 상태는 운영 데이터 없이 아래 URL로 바로 재현할 수 있습니다. 모두 `/sample-pets/`의 로컬 사진만 사용하는 **샘플 fixture**이며 Supabase에는 저장되지 않습니다. 시나리오별 이용권·재열람 기록도 기본 웹 데모와 분리됩니다.

| URL | 확인할 상태 |
| --- | --- |
| `/?scenario=first-user` | 내 강아지 없이 실제 이름의 공개 강아지 4마리가 보이는 첫 방문 화면 |
| `/?scenario=four` | 공개 샘플 강아지 4마리와 최초 공개·재열람 |
| `/?scenario=owner` | 공개 4마리 + 소파의 `내 샘플` 보너스 친구(최대 5마리) |
| `/?scenario=complete` | 오늘의 친구 4/4 완료 + 네 마리 사진 다시 보기 |
| `/?scenario=ads-off` | 이용권 0개 + 광고가 숨겨진 충전 대기 상태 |

이전에 공유한 `/?scenario=five` 주소는 같은 공개 4마리 상태를 여는 호환 별칭으로만 유지합니다.

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
| `npm run review` | 로컬 전용 강아지 검수 페이지 실행 |
| `npm run typecheck` | TypeScript 검사 |
| `npm test` | 단위 테스트 실행 |
| `npm run test:preflight` | 운영 강아지 풀 점검 도구 테스트 |
| `npm run test:review` | 내부 검수 서버 보안·API 테스트 실행 |
| `npm run build:web` | 일반 웹/Vercel용 `dist` 빌드 |
| `npm run build` | preview용 Apps in Toss `.ait` 생성 |
| `npm run build:private` | 비공개 QR용 `.ait` 생성(운영 설정 필수) |
| `npm run build:production` | 제출용 `.ait` 생성(운영 설정 필수) |
| `npm run seed:initial-pets` | 운영 private Storage와 DB에 초기 강아지 2마리·실사 5장 등록 |
| `npm run preflight:pet-pool` | 실사 확인 가능한 승인견이 8마리 이상인지 읽기 전용 점검 |

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

`supabase/migrations`를 적용한 뒤 `pet-api` Edge Function을 배포합니다. 사진은 브라우저에서 최대 1024px JPEG로 만들고, 서버에서 다시 디코드·재인코딩해 EXIF를 제거합니다. 털색은 기기에서만 제안하므로 OpenAI API나 유료 이미지 분석 키가 필요하지 않습니다. 기존에 `analyze-pet`을 배포했다면 운영 프로젝트에서 해당 Function을 제거합니다.

운영 Edge Function에는 아래 비밀값이 필요합니다. mTLS 인증서와 개인 키는 앱인토스 콘솔에서 발급한 PEM 원문이며, 절대로 `VITE_` 환경 변수나 클라이언트 번들에 넣지 않습니다.

```text
AIT_RUNTIME_ENV=production
AIT_MTLS_CERT_PEM=-----BEGIN CERTIFICATE----- ...
AIT_MTLS_PRIVATE_KEY_PEM=-----BEGIN PRIVATE KEY----- ...
USER_HASH_SALT=충분히_긴_무작위_문자열
AIT_UPLOADS_ENABLED=true
AIT_DAILY_UPLOAD_LIMIT=25
AIT_PENDING_UPLOAD_LIMIT=100
```

로컬 Edge Function에서만 `AIT_RUNTIME_ENV=local`, `AIT_ALLOW_UNVERIFIED_ANON_KEY=true`를 사용할 수 있습니다. 운영에서는 이 우회 설정이 작동하지 않으며, 익명키 검증이나 요청 빈도 확인을 수행할 수 없으면 API가 안전하게 실패합니다.

사진은 공개 URL로 저장하지 않습니다. 클라이언트가 Storage에 직접 접근하는 정책도 사용하지 않으며, 승인된 사진은 Edge Function이 발급하는 짧은 만료 시간의 서명 URL로만 제공합니다.

업로드한 강아지는 검수 전에도 업로더 본인의 집과 등록 완료 화면에 바로 나타납니다. 가장 최근의 `pending | approved` 강아지는 소파의 `내 강아지` 보너스 자리에 표시되고, 이용권·광고·오늘의 `4/4` 진행도를 사용하지 않은 채 사진을 바로 볼 수 있습니다. 검수 중 공유 링크를 받은 타인에게는 캐릭터만 보이고 원본 사진은 노출되지 않습니다. 승인 즉시 같은 공유 링크와 업로더 화면에 최종 디자인이 반영되고, 다른 사용자의 집 후보에는 다음 KST 날짜부터 편입됩니다.

한 번 연 실제 사진은 해금 방식과 무관하게 다음 무료 이용권 충전 경계까지 바로 다시 볼 수 있습니다. 이용권이 이미 두 장으로 가득 차 충전 시각이 없는 경우에만 연 시점부터 3시간을 사용합니다.

홈은 `daily_house_assignments`에 저장된 공개 강아지 4개 슬롯과 별도의 `ownerBonusPet`을 보여줍니다. 공개 슬롯은 사용자·KST 날짜별로 고정되고 공개 중지된 강아지의 슬롯만 교체됩니다. 승인견 후보가 부족해도 같은 강아지를 복제하지 않으며 빈 슬롯을 안내 상태로 남깁니다. 전체 업로드 이력은 `내가 소개한 강아지`에서 최신순으로 확인할 수 있습니다.

### `pet-api` v2 응답

새 클라이언트는 집·공개·재열람 요청에 `apiVersion: 2`를 보냅니다. `house`의 핵심 응답은 다음처럼 분리됩니다.

| 필드 | 의미 |
| --- | --- |
| `dailyPets` | 오늘 고정된 공개 강아지 최대 4마리와 `houseSlot` |
| `ownerBonusPet` | 본인의 최신 `pending | approved` 강아지 또는 `null` |
| `dailyProgress` | KST 날짜, 만난 공개견 ID, `metCount`, 고정 `totalCount: 4`, 완료 여부 |
| `allowance` | 무료 이용권 잔여량·다음 충전 시각·광고 사용/한도 |

진행도는 오늘 슬롯의 실제 사진 서명 URL을 발급한 뒤에만 기록합니다. 본인 강아지는 기록에서 제외합니다. 버전 없는 기존 앱 요청에는 종전 `pets` 응답을 유지하므로, 서버를 먼저 배포해도 라이브 구버전의 최대 5마리 레이아웃이 깨지지 않습니다.

클라이언트는 오늘의 캐릭터 요약만 5분 동안 stale-while-revalidate 방식으로 재사용합니다. 실사 사진, 서명 URL, 검수 상태는 캐시하지 않습니다. 사용자가 다시 불러오면 진행 중인 이전 요청을 취소하고 요청 세대 번호로 늦은 응답을 무시합니다. 분석 이벤트에는 강아지 이름·사진·사용자 키를 넣지 않고 집 로딩, 선택, 사진 공개 방식, 광고 결과, 공유·등록 완료 같은 비식별 상태만 기록합니다. QR/샌드박스의 Apps in Toss Analytics 전송 여부는 운영 지표로 간주하지 않고 실제 출시 환경에서 확인합니다.

### 개발용 초기 seed: 강아지 2마리·실사 5장

웹 데모에는 실제 강아지 하늘(2장)·구르미(3장)의 메타데이터 제거 JPG가 들어 있습니다. 사진마다 다른 이름과 ID를 붙이지 않고 실제 한 마리당 하나의 `pet.id`로 관리합니다. private/production 빌드에서는 이 정적 파일을 번들에서 제거하며, 운영에서는 같은 사진을 private Storage에 먼저 등록해야 합니다. 이 seed는 연결 확인용이므로 v2의 공개 4슬롯을 모두 채우지 못합니다. 정상 운영 전에는 별도로 활성 승인견을 최소 8마리 확보합니다.

최신 마이그레이션을 적용하고 `.env.review.local`에 서버 전용 키를 설정한 뒤 아래 명령으로 실제 Storage 객체까지 존재하는 승인견만 점검할 수 있습니다. 강아지 수와 이름만 출력하며 DB를 변경하지 않습니다. 8마리 미만이면 이 명령만 종료 코드 1을 반환하고 일반 빌드는 막지 않습니다.

```bash
npm run preflight:pet-pool
```

운영 기준을 임시로 바꿔 진단할 때만 `npm run preflight:pet-pool -- --min=10`처럼 명시합니다. 서비스 역할 키는 로컬 프로세스의 요청 헤더에만 사용되고 브라우저나 출력에 포함되지 않습니다.

1. 전체 마이그레이션을 적용합니다.
2. 서비스 역할 키를 저장 파일이나 `VITE_` 변수에 넣지 않고 현재 터미널에만 설정합니다.
3. 한 마리씩 확인하려면 `npm run seed:initial-pets -- --pet gureumi`처럼 실행합니다. 키는 `gureumi`, `haneul`입니다.
4. 두 마리와 실사 다섯 장을 한 번에 등록하려면 `npm run seed:initial-pets`를 실행합니다. 같은 명령을 다시 실행해도 고정 ID로 갱신됩니다.
5. 공개 순간에는 `강아지 + 사용자 + KST 날짜` 기준으로 한 장을 안정적으로 선택합니다. 같은 날 재시도할 때 사진이 갑자기 바뀌지 않습니다.

사용자 사진은 로컬 전용 검수 페이지에서 실사 사진·사용자 초안·최종 캐릭터·유사 강아지를 함께 보고 승인하거나 반려할 수 있습니다. 귀·머리·주둥이·털 윤곽·원톤/포인트·표정·소품과 최종 이름을 보정하며, 승인된 강아지도 이름/ID로 찾아 수정·공개 중지·재공개할 수 있습니다. `검수용 사진 저장`은 사진을 768px 이하 JPEG로 다시 인코딩해 EXIF를 제거하고, `검수 정보 복사`는 현재 ChatGPT 대화에 붙일 최소 정보만 만듭니다. OpenAI API는 호출하지 않으며 AI 답변 전문도 저장하지 않습니다. 신규 승인은 `review_pet_submission_v5` RPC를 거쳐 제출 원본, 최종 이름·디자인, 버전, 상태, 검수 시각과 감사 로그를 한 트랜잭션으로 기록합니다. 사용자 직접 선택 소품은 UI에서 읽기 전용이며 DB 트리거와 v5 RPC가 변경을 한 번 더 거부합니다.

```bash
# .env.review.example을 .env.review.local로 복사하고 서버 전용 키를 입력한 뒤
npm run review
```

브라우저에서 `http://127.0.0.1:4178/review`를 엽니다. 자세한 설정과 보안 원칙은 [내부 검수 페이지 안내](docs/REVIEW_CONSOLE.md)를 참고하세요. Supabase SQL Editor는 검수 페이지를 실행할 수 없을 때의 예비 수단으로만 사용합니다.

```sql
-- Storage 실존 여부를 포함한 검수 대기 목록
select *
from public.pending_pet_review_queue
order by created_at;

-- 승인
select public.review_pet_submission_v5(
  pet.id,
  'approved',
  'swan',
  null,
  '<최종_이름>',
  pet.submitted_traits,
  pet.submitted_style,
  null,
  '작은 화면과 흰 털에서 대비 확인'
)
from public.pets as pet
where pet.id = '검수할-pet-id'::uuid;

-- 반려
select public.review_pet_submission_v5(
  '검수할-pet-id'::uuid,
  'rejected',
  'swan',
  '강아지 사진을 확인하기 어려워요.',
  null,
  null,
  null,
  null,
  null
);
```

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
├─ review/        로컬 전용 검수 페이지 UI
└─ types.ts       공용 데이터 타입
tools/
└─ review-console/ 서버용 키를 보호하는 로컬 검수 서버
supabase/
├─ functions/     익명키 검증·업로드·공유 앱 API Edge Function
└─ migrations/    테이블, 정책, Storage 설정
public/
├─ pet-artwork/   추가 캐릭터 이미지
└─ sample-pets/  웹 데모용 실사 5장(운영 번들에서는 제외)
```

## 현재 확인할 점

- 고양이는 후속 범위이며 현재는 강아지만 제공합니다.
- 검수는 공개 미니앱과 분리된 로컬 전용 페이지에서 진행합니다. 삭제는 앱인토스 `⋯ > 문의하기` 요청을 받아 즉시 비공개·원본 삭제합니다.
- 운영 배포 전 접근성, 저사양 기기, iOS/Android 토스 앱 QR 테스트를 각각 진행해야 합니다.
- 초기 실사 5장은 제공자가 공개 권리를 확인한 뒤에만 운영 seed를 실행해야 합니다.
- ChatGPT는 운영자가 검수 자료를 직접 올릴 때만 참고합니다. 사람 얼굴·주소·불필요한 배경은 먼저 잘라내며, AI 답변 대신 운영자가 확정한 최종 디자인과 메모만 저장합니다.

## 참고 문서

- [Apps in Toss 개발자센터](https://developers-apps-in-toss.toss.im/)
- [Apps in Toss 예제 저장소](https://github.com/toss/apps-in-toss-examples)
- [Toss Design System](https://tossmini-docs.toss.im/tds-mobile/)
- [Vercel Vite 배포 문서](https://vercel.com/docs/frameworks/frontend/vite)

---

오늘 한 번의 귀여움으로 충분하도록. 🐾
