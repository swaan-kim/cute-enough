# 기존 강아지 사진 추가 — 앱 구현 및 검수 연결 규격

> 과거 구현·배포 기록입니다. 당시 상태·명령은 현재 운영 절차가 아닙니다. [문서 안내](../README.md)에서 현재 가이드를 확인하세요. 도감 초기화·승인·출시는 별도의 명시적 확인 없이 실행하지 않습니다.

## 현재 범위

앱의 `내가 소개한 강아지 → 사진 더 올리기`와 소유자 추가 접수 API/DB 코드를 구현했다. **추가 사진 검수 UI와 승인·반려 RPC는 구현하지 않았다.** 해당 부분은 검수 전용 작업에서 아래 규격으로 연결한다. 다른 작업에 자동 메시지를 보내거나 강아지를 승인하지 않았다.

- 같은 강아지 ID에 사진만 추가한다. 이름·원래 등록값·최종 SVG·디자인 버전·대표 사진·기존 승인 상태는 변경하지 않는다.
- 기본 상한: 현재 활성 사진 + 검수 대기 추가 사진을 합쳐 5장. 기존 3장이면 2장 추가 가능하다. 제외된 기존 사진은 삭제하지 않고 상한에서만 제외한다.
- 이미 5장 이상인 기존 강아지는 그대로 보존하며 앱 추가만 제한한다. 제작자 사진 관리의 기존 16장 호환은 유지하지만 추가 사진이 검수 중이면 예약된 자리를 초과해 기존 제외 사진을 복구할 수 없다.
- 소유자의 `pending | approved` 강아지만 추가할 수 있다. 다른 소유자·`rejected | paused | deleted`는 차단한다.
- 강아지당 검수 대기 추가 요청은 한 건. 재시도는 같은 `submissionId`를 사용하며 사진/접수/보상이 중복되지 않는다.
- 사진 추가는 새 강아지 등록이 아니다. 업로드 보너스·티켓·일일 공개 진행도·앨범 수집 권리를 지급하거나 차감하지 않는다.

## 사용자 흐름

1. 해당 강아지에서 `사진 더 올리기` 선택.
2. 서버 소유권·현재 사진 수·검수 대기 여부 확인.
3. 남은 자리만큼 사진 선택. 기기에서 순차 압축·EXIF 제거, 사진별 미리보기·삭제·재시도.
4. 선택한 모든 사진의 권리/승인 후 공개 동의 후 `사진 N장 검수 보내기`.
5. 기존 강아지 목록으로 복귀. 다시 들어오면 `기존 사진 3장 · 검수 중 2장`처럼 표시한다.
6. 결과가 불명확하면 고정 요청 ID로 확인·재시도한다. 결과를 모르면서 편집/새 요청으로 전환하지 않는다.

안내 문구:

- 선택 중: “새 사진을 검수에 보내면 귀여움을 꼼꼼히 확인해요. 승인되면 이 친구의 앨범에 살포시 더해져요 🐾”
- 접수 후: “새로운 귀여움도 검수 중이에요. 확인이 끝나면 이 친구의 앨범에 살포시 더해져요 🐾”

실제 점수나 자동 AI 검수는 없다. 추가 접수 상태 API에는 사진 URL/Storage 경로를 넣지 않는다. 현재 버전에서 접수 후 소유자는 건수·상태를 확인하고, 새 사진 자체는 검수 후 기존 사진 흐름에서 만나게 된다.

## 구현한 API (pet-api)

기존 Toss 익명키 검증·서버 계산 `ownerHash`를 사용한다. 새 액션도 인증·CORS·요청 제한을 통과해야 한다. 서비스 키를 앱에 넣지 않는다.

```ts
// 현재 상태 또는 정확한 과거 접수 확인
{ action: 'photoAdditionStatus', petId, submissionId?: string }
// response
{
  petId: string,
  activePhotoCount: number,
  pendingPhotoCount: number,
  maxPhotoCount: 5,
  remainingCount: number,
  canSubmit: boolean,
  unavailableReason?: string, // 사용자용 한국어 문구
  found?: boolean,           // exact submissionId 조회 시 필수
  submission?: {
    submissionId: string,
    petId: string,
    status: 'pending' | 'approved' | 'rejected',
    photoCount: number,      // 제출 당시 사진 수; 승인된 수가 아님
    createdAt: string,
    reviewNote?: string
  }
}

// 사진마다 순차 전송. 한 요청에서 여러 JPEG를 디코딩하지 않는다.
{ action: 'photoAdditionUpload', petId, submissionId, photoIndex: 0, dataUri }
// response
{ photoReceipt: string }

// 모두 전송된 뒤 원자적으로 pending 접수
{ action: 'photoAdditionSubmit', petId, submissionId, photoReceipts: string[] }
// response
{ submission: /* 위 submission */, remainingCount: number }
```

- 원래 등록용 `submitPhoto` 영수증과 추가 사진 영수증은 서로 바꿔 쓸 수 없다.
- HMAC 영수증은 `purpose=photo-addition`, 소유자, 강아지 ID, 접수 ID, 순서, 경로, 정규화 JPEG SHA-256, 24시간 만료에 묶인다.
- 경로: `<ownerHash>/<submissionId>/photo-addition/<petId>/staged/<index>-<randomUUID>.jpg` (비공개 `pet-photos`).
- 클라이언트 재시도 캐시는 목적·강아지·접수 ID별, 메모리에서만 최대 1시간/3건. 정상 확정 시 제거한다.
- `PHOTO_ADDITION_ALREADY_SUBMITTED`: exact 상태를 조회하여 이미 접수된 결과로 복구.
- `PHOTO_ADDITION_PENDING`, `PHOTO_ADDITION_CAPACITY_REACHED`, `PHOTO_ADDITION_NOT_ALLOWED`: 현재 상태를 다시 조회한다.
- `INVALID_PHOTO_RECEIPT`, `PHOTO_RECEIPT_EXPIRED`, `PET_PHOTO_MISSING`: 영수증 캐시를 비우고 같은 사진을 새로 전송한다.
- 정지/한도/소유권은 최종 등록 트랜잭션에서도 다시 확인한다. 파일 전송 중 승인이 바뀌어도 우회하지 못한다.
- 제한: 상태 30회/분, 개별 사진 전송 20회/시간, 최종 접수 10회/시간. 기존 업로드 운영 스위치를 따르며 이번 작업에서 스위치를 바꾸지 않았다.

## 신규 DB — 검수 작업에서 읽을 구조

마이그레이션: `supabase/migrations/20260906000600_existing_pet_photo_additions.sql`

`pet_photo_addition_submissions`

| 필드 | 의미 |
| --- | --- |
| `id` | 검수 건 고유 ID (batch ID) |
| `owner_hash`, `submission_id`, `pet_id` | 변경하면 안 되는 소유자·요청·기존 강아지 연결 |
| `status` | `pending / approved / rejected` |
| `photo_count` | 원래 제출한 1~5장의 수 |
| `created_at` | 접수 시각 |
| `reviewed_at`, `reviewed_by`, `review_note` | 후속 검수에서 기록할 항목; 메모 최대 500자 |

`pet_photo_addition_items`

| 필드 | 의미 |
| --- | --- |
| `id` | 추가 사진의 고유 item ID |
| `batch_id` | 위 검수 건의 `id` |
| `photo_index` | 제출 순서 0~4 |
| `storage_path`, `sha256` | 저장한 JPEG의 경로와 SHA-256; 파일을 다른 내용으로 덮어쓰지 않음 |
| `created_at` | 저장 시각 |

두 테이블은 RLS 적용, `anon/authenticated` 접근 없음. `service_role`은 조회만 가능하며 직접 쓰기 권한을 열지 않았다. 접수용 SECURITY DEFINER RPC만 기록한다. 검수 승인도 후속 전용 RPC로 구현해야 한다.

**대기 사진을 `pet_photos`에 먼저 넣으면 안 된다.** 기존 공개/앨범 조회와 제작자 사진 복구 목록에 섞일 수 있다. 지금은 별도 테이블에만 있어 공개·앨범·사진 총수에 영향을 주지 않는다.

## 검수 전용 작업에서 구현할 것 (아직 없음)

### 목록·사진 확인

- 기존 신규 강아지 승인 대기 목록과 별개로 `추가 사진 검수` 탭/구역을 만든다.
- `pet_photo_addition_submissions.status='pending'`와 items를 batch ID로 조회한다.
- 기존 강아지의 이름·현재 공개 SVG·대표 실사와 추가 사진들을 함께 보여, 같은 강아지인지 확인한다.
- 기존 로컬 검수의 불투명 이미지 프록시로 items의 사진을 한 장씩 크게 보여준다. 서비스 키, 영수증, 원본 경로를 공개 앱이나 ChatGPT 프롬프트에 노출하지 않는다.
- 사진 누락/해시 불일치/불러오기 실패가 있으면 승인하지 말고 재시도를 제공한다.
- 기존 사진 관리 버튼이나 원래 강아지 승인 버튼이 이 추가 검수 건까지 자동 승인해서는 안 된다.

### 승인·반려 트랜잭션 제안

다음 RPC 이름은 **제안이며 아직 존재하지 않는다**: `review_pet_photo_addition`.

입력 예: `batchId`, `expectedStatus='pending'`, `acceptedItemIds`, `reviewer`, `reviewNote`.

1. 기존 `pets` 행을 `FOR UPDATE`로 잠근 다음 batch/items를 잠근다. 잠금 순서는 기존 사진 관리와 동일하게 `pet → batch/items → Storage`로 통일한다.
2. batch가 여전히 pending인지, 실제 소유자가 일치하는지, 강아지가 pending/approved인지 확인한다. 중복 확정 요청에는 기존 결과를 반환하거나 명시적인 stale 오류를 낸다.
3. 선택 item의 소속·원본 존재·저장 해시·최종 활성 사진 수를 검사한다. 새 사진은 검수자가 지정한 항목만 포함한다.
4. 승인 사진에만 새로운 `pet_photos.id`를 한 번 만들고 기존 사진 순서 뒤에 붙인다. 동일 item을 두 번 삽입하지 못하도록 `source_addition_item_id` unique 연결 또는 전용 매핑 테이블을 후속 마이그레이션으로 추가한다.
5. 한 장 이상 선택하면 batch approved, 전부 반려하면 rejected. 원래 photo_count/items는 보존하고 승인/반려 item별 결과를 새 필드/감사 테이블에 남긴다. 일부 승인 시 메모에 결과를 명확히 남긴다.
6. 검수자·시각·메모·기존/추가 사진 ID·변경 전후 값을 감사 기록과 함께 같은 트랜잭션에서 저장한다.
7. 새 활성 사진 삽입과 batch 상태 전환은 같은 트랜잭션이어야 한다. 현재 DB에는 검수 중 예약 수와 활성 사진 합계가 5장을 넘지 않도록 지연 검사하는 제약 트리거가 있다.

반드시 유지할 경계:

- `pets.status`, 이름, 원래 요청, SVG/디자인 버전, 대표 사진은 사진 추가 승인으로 변경하지 않는다. 대기 강아지의 사진을 승인해도 강아지 자체 승인은 별도다.
- 원래 사진 ID·파일·sort_order·수집권·하트·감사 기록을 삭제하거나 재생성하지 않는다.
- 반려한 원본/접수도 보존한다. 승인 실패 직후 Storage 파일을 무조건 삭제하지 않는다. 정리 시 기존 pets/pet_photos뿐 아니라 새 items 연결 및 진행 중 요청도 확인해야 한다.
- 추가 사진을 다른 유저에게 자동으로 수집시켜 주지 않는다. 승인 후 해당 강아지의 활성 전체 사진 수만 늘고, 기존 하루 한 장/오늘 집 배정/티켓 수집 정책을 그대로 따른다.
- 소유자는 승인 후 다음 사진 조회부터 기존 무료 소유자 열람 흐름에서 새 사진을 볼 수 있어야 한다. 사진을 추가해도 강아지가 집에 복제되거나 오늘 명단이 바뀌어서는 안 된다.

## 배포·확인 경계

- 이번 작업: 로컬 소스·테스트. 원격 DB 적용, Edge 배포, AIT 생성/업로드, 운영 사진 수정, 개별 승인을 수행하지 않는다.
- 신규 등록용 `004`와 이번 `006`의 적용 여부를 먼저 확인한다. 이미 적용된 `005` 등 다른 이력을 지우거나 되돌리지 않는다.
- 검수 전용 추가 사진 승인 기능을 먼저 완성한 뒤 운영 접수를 연다. 접수만 배포하면 추가 사진이 계속 pending으로 남는다.
- 순서: 필요한 호환 마이그레이션 → 추가 접수/검수 API → 로컬 검수 서버 → 새 AIT → Toss QR A/B 확인.
- 검증: A의 기존 3장에 2장 접수, B의 공개 사진은 여전히 3장, 제작자 명시 승인 후 총 5장, 원래 3장의 ID·수집권 불변, A는 다음 조회부터 승인 사진 열람. 전부/일부 반려·동시 접수·통신 실패·중복 확정도 확인한다.

실제 승인 결과의 앱 반영은 검수 승인 구현과 원격 배포 이후에만 실기기로 검증할 수 있다.

## 로컬 검증 결과

- 앱·Edge Function: 83개 파일 / 838개 Vitest 테스트 통과.
- 추가 사진 RPC PGlite 15개 + 초기 다중 사진 등록 회귀 9개 통과.
- 기존 검수 서버·SVG·사진 관리 Node/PGlite 45개 통과. 해당 검수 구현을 수정하지 않고 회귀만 확인했다.
- 타입 검사, 웹 빌드, Edge Deno 검사 통과. 기존 JS 청크 크기/import 혼용 경고는 별도 성능 과제로 남아 있다.
- 360×640, 390×844 로컬 브라우저에서 기존 1장에 새 4장 선택·미리보기·동의·접수·기존 목록 복귀·다시 진입하여 `기존 1장/검수 중 4장` 확인. 가로 넘침 없고 사진 버튼/삭제 영역 44px 이상.
- 테스트는 독립 preview origin의 샘플 데이터로 수행했다. 운영 사진을 보내거나 승인한 것이 아니다.
- PGlite는 단일 백엔드이므로 병렬 요청 결과는 확인했지만 실제 PostgreSQL 다중 연결 잠금 타이밍 검증을 대신하지 않는다. Toss QR 실기기 확인도 배포 이후에 필요하다.
