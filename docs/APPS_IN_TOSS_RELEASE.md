# 앱인토스 제출 체크리스트

이 문서는 `appName: cute-enough`, 노출명 `오늘의 강아지`의 비공개 QR 검수와 제출 순서를 기록합니다. Vercel은 샘플 데이터 화면 확인용이며 제출 판정에 사용하지 않습니다.

## 1. 외부 연결 전 확인

다음 항목은 계정 권한 또는 비용이 생길 수 있으므로 저장소 작업만으로 자동 실행하지 않습니다.

- Supabase 프로젝트 요금제·Storage/Edge Function 예상 사용량 확인
- 앱인토스 익명키 검증용 mTLS 인증서와 개인 키 발급
- 운영자가 제공 권리를 가진 강아지 사진 5장 확보
- 사업자·정산·리워드 광고 그룹 승인과 실광고 그룹 ID 확인
- 영구 공개 저장소에 1200×600 공유 OG 이미지 업로드

유료 OpenAI/GPT 이미지 분석은 사용하지 않습니다.

## 2. Supabase 적용

운영 프로젝트를 확인한 뒤 아래 순서로 적용합니다.

```bash
supabase link --project-ref <PROJECT_REF>
supabase db push
supabase functions deploy pet-api --no-verify-jwt
```

`pet-api`는 클라이언트 JWT 대신 앱인토스 익명키를 mTLS로 검증합니다. 다음 값은 Supabase secrets로만 저장하고 `VITE_` 변수나 Git에 넣지 않습니다.

```text
AIT_RUNTIME_ENV=production
AIT_MTLS_CERT_PEM=<PEM 원문>
AIT_MTLS_PRIVATE_KEY_PEM=<PEM 원문>
USER_HASH_SALT=<충분히 긴 무작위 값>
AIT_REWARDED_ADS_ENABLED=false
```

광고 승인 후 QR 재검수할 때만 `AIT_REWARDED_ADS_ENABLED=true`로 바꿉니다. CORS의 추가 로컬 origin은 운영 환경에 설정하지 않습니다.

기존 `analyze-pet` Edge Function이 배포되어 있다면 운영 프로젝트에서 제거합니다. 현재 앱은 기기에서 JPEG 1024px 이하로 재인코딩하고 밝기·주요 색상만 제안합니다. 강아지 여부와 실제 공개 여부는 운영자가 검수합니다.

## 3. 기본 강아지 등록

- 제공 권리를 확인한 사진 5장을 private Storage에 업로드합니다.
- DB에는 `approved` 상태, 캐릭터 traits, 검수 일시와 검수자 기록을 저장합니다.
- 공개 URL을 만들지 않습니다. 사진 공개 시 `pet-api`가 짧은 만료 시간의 서명 URL만 반환하는지 확인합니다.
- 개발용 Unsplash 샘플 URL은 제출 데이터에 사용하지 않습니다.

## 4. 비공개 QR 빌드

`.env.private.local` 또는 CI 비밀변수에 아래 값을 연결합니다.

```text
VITE_APP_RUNTIME=private
VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<SUPABASE ANON KEY>
VITE_ADS_ENABLED=false
VITE_REWARDED_AD_GROUP_ID=
VITE_SHARE_OG_URL=https://<PERMANENT PUBLIC HOST>/share-og.png
```

```bash
npm ci
npm test
npm run typecheck
npm run build:private
```

생성된 `cute-enough.ait`를 콘솔에 올리고 Toss QR에서 확인합니다.
비공개 공유 링크는 최초 QR 실행 스킴의 `_deploymentId`를 자동으로 보존하므로, 앱을 반드시 해당 배포의 QR로 연 뒤 공유를 시험합니다.

## 5. Toss QR 필수 시나리오

- 홈에서 첫 강아지는 광고 없이 입장
- 광고 미승인 상태에서는 두 번째·세 번째 광고 UI가 보이지 않음
- 사진 허용, 거부, 취소, 권한 철회, 미지원 앱 버전 안내
- 이름 4글자 제한, 제로폭·제어문자·금칙어 차단
- 업로드 직후 내 강아지가 홈에 등장하고 `내 강아지 무료 1회`로 입장
- pending 공유 수신자는 캐릭터만 보고 사진·광고·일일 횟수는 사용하지 않음
- approved 공유 수신자는 최신 이용권 상태에 따라 입장
- 네이티브 뒤로가기: 모달 → 이전 앱 화면 → 루트에서 토스로 복귀
- 네이티브 홈: 어느 화면에서든 홈 스택으로 초기화
- KST 자정 이후 일일 무료 이용권 초기화
- 오프라인·서버 지연·CORS 차단 시 가짜 성공이나 보상 없음

광고 승인 후에는 실광고 그룹 ID를 넣고 클라이언트와 서버의 광고 플래그를 함께 켠 뒤 다음을 추가로 검수합니다.

- 광고 안내창에서 취소 가능
- 광고가 로드된 경우에만 확인 CTA 활성화
- `userEarnedReward` 후 정상 종료된 경우에만 입장 권한 지급
- 건너뛰기·오류·중복 이벤트에는 보상 없음
- 광고 전 소리 중지, 복귀 후 사용자의 음소거 설정 복원

## 6. 제출 자료

- 600×600 불투명 정사각형 앱 아이콘
- 1932×828 썸네일
- 636×1048 세로 스크린샷 최소 3장
- 부제, 상세 이용 흐름, 비게임 카테고리
- 고객센터, 개인정보처리방침, 이용약관 URL
- 홈 스킴과 `/pet/:id` 공유 스킴

최종 제출 빌드는 다음 환경으로 생성합니다.

```text
VITE_APP_RUNTIME=production
```

```bash
npm run build:production
```

빌드 검증은 Supabase 설정 누락, 테스트 광고 ID, Vercel OG 주소, 광고 플래그와 광고 ID 불일치를 실패 처리합니다.
