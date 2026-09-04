# 내부 강아지 검수 페이지

운영자가 제출된 강아지의 **실사 사진, 앱 캐릭터, 이름**을 한 화면에서 확인하고 승인하거나 반려하는 로컬 전용 도구입니다.

## 보안 원칙

- 검수 페이지는 `127.0.0.1`에만 열리며 Vercel이나 공개 인터넷에 배포하지 않습니다.
- Supabase 서버용 비밀키는 브라우저 코드에 포함되지 않습니다.
- 비밀키가 들어가는 `.env.review.local`은 Git에서 제외됩니다.
- 서버가 private Storage의 3분짜리 서명 URL로 사진을 읽고, 브라우저에는 저장 경로가 없는 로컬 불투명 사진 주소만 전달합니다.
- 신규 승인과 반려는 `review_pet_submission_v5` RPC를 거치므로 최종 이름·traits·털 스타일·표정·소품·디자인 버전·상태 변경과 감사 로그가 함께 남습니다.
- 사용자가 직접 고른 소품은 검수 화면에서 읽기 전용이며, DB 트리거와 v5 RPC도 다른 소품으로의 변경을 거부합니다.

## 처음 한 번 설정하기

1. 저장소 루트의 `.env.review.example`을 `.env.review.local`이라는 이름으로 복사합니다.
2. Supabase Dashboard에서 `cute-enough-production` 프로젝트를 엽니다.
3. **Project Settings → API Keys**에서 서버 전용 Secret key를 확인합니다.
4. `.env.review.local`의 `REVIEW_SUPABASE_SECRET_KEY`에 붙여 넣습니다. 기존 프로젝트에 legacy `service_role` 키만 있다면 예시 파일에 안내된 대체 변수에 넣어도 됩니다.

```env
REVIEW_SUPABASE_URL=https://xoqjehiqbaxpalbghngm.supabase.co
REVIEW_SUPABASE_SECRET_KEY=여기에_서버용_비밀키
REVIEW_OPERATOR_ID=swaan-kim
REVIEW_PORT=4178
```

비밀키를 `VITE_`로 시작하는 환경변수, GitHub, 채팅, 브라우저 저장소 또는 공유·동기화 폴더에 넣지 마세요. 가능하면 이 검수 도구 전용 Secret key를 따로 발급합니다. 실수로 노출했다면 파일만 지우지 말고 Supabase Dashboard에서 해당 키를 즉시 폐기하거나 교체하세요.

## 실행하기

```bash
npm ci
npm run review
```

브라우저에서 [http://127.0.0.1:4178/review](http://127.0.0.1:4178/review)를 엽니다.

## 검수 흐름

1. `검수 대기`에서 실사 사진과 64·114·190px 캐릭터, 이름, 비슷한 승인 강아지를 함께 확인합니다.
2. **검수용 사진 저장**으로 768px 이하·EXIF 제거 JPEG를 받고, **검수 정보 복사**로 현재 ChatGPT 대화에 붙일 정보를 복사합니다. 사람 얼굴·주소·불필요한 배경이 남아 있으면 먼저 잘라낸 뒤 올립니다.
3. 실사에 맞게 귀·머리·주둥이·털 윤곽·원톤/포인트·표정·소품을 보정합니다. 단색 강아지에 사진에 없는 얼룩을 만들지 않습니다. 사용자가 직접 선택한 소품은 바꾸지 않고, `검수자에게 맡기기`인 경우에만 최종 소품을 고릅니다.
4. ChatGPT 답변 전문은 저장하지 않고 최종 디자인과 짧은 검수 메모만 남긴 뒤 **승인**합니다. 유사도 80점 이상인 초안을 그대로 승인할 때는 구분 근거가 필수입니다.
5. 반려할 때는 사용자에게 이해될 수 있는 사유를 입력한 뒤 **반려**를 누릅니다.
6. 처리된 항목은 대기 목록에서 사라지고 다음 항목이 표시됩니다.

이미 승인된 강아지는 상단 **승인된 강아지 관리**에서 이름이나 ID로 찾습니다. 디자인 보정, 공개 중지, 보정 후 재공개는 모두 변경 메모가 필수이며 `designVersion`과 감사 로그가 함께 갱신됩니다.

승인 즉시 기존 공유 링크에서 승인 상태가 반영됩니다. 다른 사용자의 오늘 집 구성은 유지되며, 해당 강아지는 다음 KST 날짜부터 공개 후보에 포함됩니다.

사용자에게 보이는 상태는 다음과 같습니다.

| 상태 | 업로더 화면 | 타인 공유 |
| --- | --- | --- |
| `pending` | `검수 중 · 사진은 나만 볼 수 있어요`와 사진 바로 보기 | 캐릭터 교감만 제공, 사진·이용권·광고 사용 없음 |
| `approved` | `승인됨 · 모두가 만날 수 있어요`와 최종 디자인 | 현재 이용권 상태에 맞는 실제 사진 흐름 |
| `rejected` | 반려 사유와 `다른 사진으로 다시 소개하기` | 이용 불가 |
| `paused` | 공개 중지 안내와 문의 경로 | 이용 불가 |

## 목록이 비어 있을 때

- 실제 Toss private/production 빌드에서 올린 사진인지 확인합니다. Vercel preview 업로드는 해당 브라우저에만 저장됩니다.
- Supabase의 `public.pending_pet_review_queue`에 해당 강아지가 있는지 확인합니다.
- 사진이 없다면 승인할 수 없습니다. 업로드 또는 Storage 상태를 먼저 복구합니다.
- 우측 상단 **새로고침**으로 최신 대기열을 다시 불러옵니다.

## 공개 강아지 풀 사전 점검

오늘의 공개 슬롯 5개를 안정적으로 채울 여유분까지 포함해, 실사 확인 가능한 승인견을 최소 8마리 유지합니다. 최신 마이그레이션과 같은 `.env.review.local` 설정을 사용해 다음 읽기 전용 점검을 직접 실행합니다.

```bash
npm run preflight:pet-pool
```

점검은 `approved` 상태, 활성 `pet_photos` 행, private `pet-photos` Storage 객체가 모두 있는 고유 강아지만 셉니다. 결과에는 강아지 수·이름·활성 사진 수만 표시되며 서버 전용 키와 Storage 경로는 표시되지 않습니다. 8마리 미만이면 이 명령만 종료 코드 1로 끝나므로 CI나 일반 빌드에 자동 연결하지 마세요.

Supabase SQL Editor에서 같은 내용을 확인해야 한다면 아래 서비스 역할 전용 읽기 함수만 호출합니다.

```sql
select *
from public.get_approved_active_photo_pet_pool();
```

## Dashboard에서 처리하는 예비 방법

검수 페이지를 실행할 수 없을 때만 Supabase SQL Editor에서 아래 RPC를 사용합니다. `pets.status`를 직접 수정하면 감사 로그가 빠질 수 있습니다.

```sql
select public.review_pet_submission_v5(
  pet.id,
  'approved',
  '<operator_id>',
  null,
  '<최종_이름>',
  pet.submitted_traits,
  pet.submitted_style,
  null,
  '흰 털과 작은 화면에서 대비 확인'
)
from public.pets as pet
where pet.id = '<pet_id>'::uuid;

select public.review_pet_submission_v5(
  '<pet_id>'::uuid,
  'rejected',
  '<operator_id>',
  '강아지 사진을 확인하기 어려워요.',
  null,
  null,
  null,
  null,
  null
);
```

## 공개 운영자 페이지가 필요해질 때

현재 도구는 초기 1인 운영을 위한 로컬 도구입니다. 여러 운영자가 원격으로 검수해야 할 때는 서비스 키를 공개 페이지에 넣지 말고 Supabase Auth, 운영자 허용 목록, 서버 세션을 갖춘 별도 운영자 서비스로 전환합니다.
