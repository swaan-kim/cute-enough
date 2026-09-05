# 이용권 충전 알림 운영

충전 알림은 별도 선택 기능이다. 코드와 SQL을 배포해도 발송되지 않으며, Toss 동의문·기능성 캠페인 승인과 실제 QR 검증을 마칠 때까지 아래 두 운영 스위치를 끈 상태로 유지한다. 이 작업에서 실제 사용자에게 알림을 보내지 않았다.

## 동작과 보관

- 무료 이용권 잔액이 0이 되면 기존 자연 충전 기준 시각 + 3시간에 작업을 예약한다. 1→2 충전, 광고 완료, 공유 보너스 적립은 예약 원인이 아니다.
- 발송 직전에 동의, 실제 무료 잔액, 충전 후 방문 여부, 오늘 공개견 4마리 완료 여부를 다시 확인한다. KST 21:00 이상~08:00 미만은 다음 08:00까지 보류한다.
- KST 하루에 사용자당 한 번만 발송을 시도한다. 응답 유실처럼 결과를 확인할 수 없는 시도도 한도를 사용한다. 다음 날 새로운 자연 충전은 다시 대상이 될 수 있다.
- 명시적인 `충전되면 알려주세요` 동작에서 Toss 동의를 받은 뒤만 신청한다. 알림 문구는 제목 `이용권 충전`, 본문 `강아지 이용권이 충전됐어요.`인 승인 템플릿을 사용한다.
- 수신자 키는 별도 AES-256-GCM 키로 암호화하며 사용자 해시를 인증 데이터에 묶는다. 공개 API 응답, 클라이언트 환경 변수, 로그에 원본 키나 암호문을 출력하지 않는다.
- 해제하면 암호화한 수신자 키·템플릿·동의 시각을 지우고 대기/선점 작업을 취소한다. 이미 외부 전송을 시작한 요청은 취소할 수 없다. 중복 방지용 결과 기록은 남긴다.
- 운영 중단 중에도 기존 신청 상태 조회와 해제를 허용한다. 템플릿 코드를 바꾸면 이전 코드로 신청한 알림을 보내지 않으며 새 동의를 받아야 한다.

## 서버 설정

다음 값은 Supabase Edge Function secrets로만 설정한다. `.env` 값을 출력하거나 쉘 인수·커밋에 실제 비밀값을 넣지 않는다. Vercel과 `VITE_` 변수에는 연결하지 않는다.

| 이름 | 값/용도 |
| --- | --- |
| `RECHARGE_NOTIFICATIONS_ENABLED` | 초기값 `false`. 신규 신청과 Edge worker 발송을 켜는 스위치 |
| `RECHARGE_NOTIFICATION_TEMPLATE_CODE` | 동의문이 연결되고 승인된 Toss 기능성 캠페인의 템플릿 코드 |
| `NOTIFICATION_KEY_ENCRYPTION_KEY` | 암호학적으로 생성한 32바이트의 base64. 사용자 해시 salt와 별도 보관 |
| `RECHARGE_NOTIFICATION_CRON_SECRET` | cron 전용으로 충분히 긴 무작위 비밀값 |
| `AIT_MTLS_CERT_PEM` / `AIT_MTLS_PRIVATE_KEY_PEM` | 앱인토스 파트너 API용 기존 서버 mTLS 인증서와 개인 키 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase가 제공하는 서버 전용 기본 설정 |

암호화 키를 단순히 교체하면 기존 수신자 키를 복호화할 수 없게 된다. 별도의 서버 재암호화 또는 신청 해제·재동의 절차를 마련한 뒤 교체한다.

## 마이그레이션과 예약 작업

`20260905000400_recharge_notifications.sql`은 알림 전용 테이블/RPC와 `pet_free_allowances` 예약 트리거를 만든다. `pets` 행이나 검수 상태를 변경하지 않는다. 무료 이용권/일별 배정 테이블과 공개 4마리 마이그레이션을 먼저 준비한다.

운영 마이그레이션 이력과 실제 함수 정의를 대조한 뒤 이 파일만 순서에 맞게 적용한다. 이 저장소에는 과거 개별 강아지 데이터 수정 SQL도 있으므로, 이력에 없다는 이유로 모든 과거 SQL을 일괄 재실행하지 않는다. 수동 적용한 SQL은 내용 확인 후 이력만 맞춘다.

마이그레이션은 Supabase의 `pg_cron`, `pg_net`을 활성화하고 매분 `dispatch_recharge_notification_worker()`를 호출하는 cron 항목을 만든다. 네트워크 호출은 `recharge_notification_worker_config.enabled = false`인 동안 발생하지 않는다. Vault는 Supabase의 기존 `vault.decrypted_secrets`를 사용한다.

1. `recharge-notifications` Edge Function을 배포한다. `verify_jwt = false`이지만 POST의 `x-recharge-cron-secret`을 검증하므로 공개 호출로 발송할 수 없다.
2. Supabase Vault에 `recharge_notification_cron_secret`이라는 이름으로 Edge의 cron secret과 같은 값을 저장한다. 실제 값은 안전한 관리 화면 또는 값이 출력되지 않는 서버 절차로 입력한다.
3. 아래처럼 대상 URL만 설정한다. 아직 `enabled`는 켜지 않는다.

```sql
update public.recharge_notification_worker_config
set function_url = 'https://xoqjehiqbaxpalbghngm.supabase.co/functions/v1/recharge-notifications',
    enabled = false
where singleton;
```

worker는 한 번에 기본 5개를 처리한다. 외부 요청 제한 시간은 건당 8초이며, cron HTTP 호출 제한 시간은 50초이다. 처리하지 못한 선점 작업은 15분 뒤 다른 worker가 복구할 수 있다.

## 활성화 전 확인

Toss 콘솔에서 알림 동의문을 만들고 위 문구의 기능성 캠페인에 연결한 뒤 승인된 템플릿 코드를 확인한다. SDK 동의 콜백과 발송 응답 계약은 [공식 동의 SDK 문서](https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EC%9D%B8%ED%84%B0%EB%A0%89%EC%85%98/requestNotificationAgreement.html)와 [스마트 발송 개발 문서](https://developers-apps-in-toss.toss.im/smart-message/develop.html)를 기준으로 한다.

실제 QR에서 Android/iOS의 동의·거절·재동의·해제를 확인한다. 발송 테스트는 사용자가 지정한 테스트 수신자와 범위로 별도 수행한다. 승인 대기견을 테스트 목적으로 승인하지 않는다. 테스트 통과 기록과 사용자 확인 후 Edge 스위치 및 DB worker 스위치를 켠다. 두 스위치 중 하나라도 꺼져 있으면 cron을 통한 새로운 발송 실행을 시작하지 않는다.

## 중단과 장애 처리

긴급 중단은 DB worker 설정 `enabled = false`와 Edge의 `RECHARGE_NOTIFICATIONS_ENABLED = false`로 한다. 이미 시작한 worker 실행과 HTTP 요청은 끝날 수 있다. 운영 중단은 무료/보너스 티켓, 이미 받은 광고 보상, 기존 신청 기록을 차감하거나 삭제하지 않는다. 신청 해제 요청은 계속 처리한다.

작업 흐름은 `scheduled → claimed → sending → sent | failed | unknown`이다. 최종 대상 확인에서 제외되면 `skipped`, 해제·방문·충전 주기 변경은 `cancelled`가 된다. `sending` 상태에서 worker가 끊기면 15분 뒤 `unknown`으로 종료하며 자동 재전송하지 않는다. Toss가 이미 수락했을 가능성이 있으므로 `sent`/`failed`/`unknown`의 상태나 `attempt_date`를 지워 재전송하지 않는다.

상태별 건수와 사유만 집계해 관찰한다. 키·원본 API 응답 없이 다음 SQL로 확인할 수 있다.

```sql
select state, outcome_reason, count(*)
from public.recharge_notification_jobs
group by state, outcome_reason
order by state, outcome_reason;
```

`template_changed_requires_agreement`는 새 동의가 필요하고, `network_outcome_unknown`/`worker_interrupted`는 결과 확인이 필요하다. HTTP 200만으로 성공 처리하지 않으며 Toss 응답의 실제 푸시 발송 수와 상세 성공 목록을 확인한다.

## 자동 검증

`notification-recharge.node-test.mjs`는 PGlite에서 실제 PostgreSQL 알림 SQL을 실행한다. 시간만 고정하고 cron/HTTP 확장을 무송신 스텁으로 대체한다. 동의 해제, 자연 충전, 보너스 제외, 21:00·08:00 경계, 방문/오늘 완료, 재신청, 선점 토큰, 같은 날 한도, 불명확한 결과의 재전송 방지를 검증한다. 다중 DB 연결의 실제 동시 실행이나 Toss 실기기 동작을 대신하지는 않는다.

```powershell
$env:PGLITE_MODULE_PATH = Join-Path $env:TEMP 'cute-enough-reward-pglite/node_modules/@electric-sql/pglite/dist/index.js'
node --test supabase/migrations/notification-recharge.node-test.mjs
```

암호화·설정 API·SDK cleanup·응답 판정·worker의 발송 중복 방지는 관련 Vitest 테스트로 별도 확인한다.
