# 내부 강아지 검수 페이지

운영자가 제출된 강아지의 **실사 사진, 앱 캐릭터, 이름**을 한 화면에서 확인하고 승인하거나 반려하는 로컬 전용 도구입니다.

## 보안 원칙

- 검수 페이지는 `127.0.0.1`에만 열리며 Vercel이나 공개 인터넷에 배포하지 않습니다.
- Supabase 서버용 비밀키는 브라우저 코드에 포함되지 않습니다.
- 비밀키가 들어가는 `.env.review.local`은 Git에서 제외됩니다.
- 서버가 private Storage의 3분짜리 서명 URL로 사진을 읽고, 브라우저에는 저장 경로가 없는 로컬 불투명 사진 주소만 전달합니다.
- 승인과 반려는 `review_pet_submission` RPC를 거치므로 상태 변경과 감사 로그가 함께 남습니다.

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

1. `검수 대기`에서 실사 사진과 실제 앱 캐릭터, 이름, 등록 시각을 함께 확인합니다.
2. 문제가 없으면 **승인**을 누르고 확인합니다.
3. 반려할 때는 사용자에게 이해될 수 있는 사유를 입력한 뒤 **반려**를 누릅니다.
4. 처리된 항목은 대기 목록에서 사라지고 다음 항목이 표시됩니다.

승인 즉시 기존 공유 링크에서 승인 상태가 반영됩니다. 다른 사용자의 오늘 집 구성은 유지되며, 해당 강아지는 다음 KST 날짜부터 공개 후보에 포함됩니다.

## 목록이 비어 있을 때

- 실제 Toss private/production 빌드에서 올린 사진인지 확인합니다. Vercel preview 업로드는 해당 브라우저에만 저장됩니다.
- Supabase의 `public.pending_pet_review_queue`에 해당 강아지가 있는지 확인합니다.
- 사진이 없다면 승인할 수 없습니다. 업로드 또는 Storage 상태를 먼저 복구합니다.
- 우측 상단 **새로고침**으로 최신 대기열을 다시 불러옵니다.

## Dashboard에서 처리하는 예비 방법

검수 페이지를 실행할 수 없을 때만 Supabase SQL Editor에서 아래 RPC를 사용합니다. `pets.status`를 직접 수정하면 감사 로그가 빠질 수 있습니다.

```sql
select public.review_pet_submission(
  '<pet_id>'::uuid,
  'approved',
  '<operator_id>',
  null
);

select public.review_pet_submission(
  '<pet_id>'::uuid,
  'rejected',
  '<operator_id>',
  '강아지 사진을 확인하기 어려워요.'
);
```

## 공개 운영자 페이지가 필요해질 때

현재 도구는 초기 1인 운영을 위한 로컬 도구입니다. 여러 운영자가 원격으로 검수해야 할 때는 서비스 키를 공개 페이지에 넣지 말고 Supabase Auth, 운영자 허용 목록, 서버 세션을 갖춘 별도 운영자 서비스로 전환합니다.
