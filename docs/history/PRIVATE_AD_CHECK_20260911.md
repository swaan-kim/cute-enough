# 계정 기록과 분리된 광고 연결 테스트

> 과거 구현·배포 기록입니다. 당시 상태·명령은 현재 운영 절차가 아닙니다. [문서 안내](../README.md)에서 현재 가이드를 확인하세요. 도감 초기화·승인·출시는 별도의 명시적 확인 없이 실행하지 않습니다.

같은 토스 익명키의 수집 기록은 서버에 유지된다. 이미 모은 사진을 다시 보면 무료이므로 티켓이 줄지 않는다. 광고 테스트를 위해 운영 계정을 초기화하거나 다른 익명키를 만들지 않는다.

## 이번 테스트 파일

- 시작 화면: `광고 연결을 확인해요` → `테스트 티켓 0장` → `테스트 광고 보기`.
- 실제 계정·강아지·수집·등록·보상 API는 호출하지 않는다. 0장은 화면의 테스트 상태이며 실제 잔액을 변경하지 않는다.
- 평소 앱과 같은 RewardedAdController/SDK를 사용하며 공식 `ait-ad-test-rewarded-id`만 사용한다.
- 로드 후 명시적으로 누를 때만 광고 표시. 시청 완료 콜백이 있어야 완료로 표시한다. 닫힘 이벤트 누락 시 앱으로 돌아와 명시적 확인 버튼을 누를 수 있다.
- 이 검사는 SDK 연결/테스트 광고 표시/완료 이벤트 확인용이다. 운영 광고 물량, 실제 서버 보상·사진 공개 전체 흐름을 검증한 것은 아니다.
- 기존 운영 후보 `20260911-31` 및 `AIT/LATEST`는 변경하지 않았다. 이번 파일은 일반 사용자 출시/검토 요청 대상이 아니다.

## 격리

`VITE_AD_DIAGNOSTICS=true`는 private + 광고 ON + 광고 테스트 모드 + 정확한 공식 테스트 ID에서만 빌드 가능하다. URL이나 계정 설정으로 켤 수 없다. production/preview 산출물에서 진단 화면 마커 유출도 검사한다.

환경 파일은 수정하지 않았다. 공통 잠금 빌드 래퍼를 사용하며 필요한 경우 별도 PowerShell 세션에서 다음과 같이 재생성한다.

```powershell
$env:VITE_APP_RUNTIME='private'
$env:VITE_AD_DIAGNOSTICS='true'
$env:VITE_ADS_ENABLED='true'
$env:VITE_ADS_TEST_MODE='true'
$env:VITE_REWARDED_AD_GROUP_ID='ait-ad-test-rewarded-id'
npm run build:private
```

끝나면 해당 터미널 세션을 종료한다. 위 값을 production 빌드에 재사용하지 않는다.

## 검증·파일

- 전체 테스트 99개 파일 / 1,020개 통과. 광고 컨트롤러/진단 화면 51개, 빌드 설정 가드 39개 통과.
- 타입 검사, production web-only 빌드(진단 코드 미포함), private AIT 빌드 통과.
- 390×844 실제 빌드 화면 확인: 54px 버튼, 가로 넘침 없음. 일반 브라우저에서는 네이티브 광고 미지원으로 실패 안내가 나타나는 것이 정상이다.
- production LATEST 파일과 SHA-256 유지 확인.
- 생성: 2026-09-11 22:04:15 KST, 2,683,126 bytes.
- deploymentId: `01a09091-95a3-7e12-a0e2-287cf1f6aeab`.
- SHA-256: `f999046cb5d5bcb90b58de772f01b1d4ec7d26dc7d32ea5f5e77fc3da79235e6`.
- 소스: `a20041e5334bc8d57e41a18d72388f62b56f754b` + 입력 fingerprint `4cdf6892d2f79a6cdb60250a98683738cb36758ef4b72479f85d3d706e107d93`.
- Node 24.14.1 / SDK 3.1.1 / private / adsTestMode=true / adDiagnostics=true.
- 경로: `AIT/TEST/2026-09-11_private_01a09091-95a3-7e12-a0e2-287cf1f6aeab/cute-enough.ait`.
- 원본 AIT의 진단 화면·공식 테스트 ID 포함, 운영 광고 ID 미포함과 파일 해시를 확인했다.
- `20260911-32` 업로드 완료, 본인 테스트 푸시 발송 및 테스트 환경 준비 완료. 휴대폰에서 실제 광고가 열리는지는 사용자 확인 대기 중이다.
- [테스트 QR](https://apps-in-toss.toss.im/workspace/17687/mini-app/67857/app-build?testDeploymentId=01a09091-95a3-7e12-a0e2-287cf1f6aeab&testVersionName=20260911-32)
- 본인 딥링크: `intoss-private://cute-enough?_deploymentId=01a09091-95a3-7e12-a0e2-287cf1f6aeab&host=appsInTossHost`.

[앱인토스 공식 광고 가이드](https://developers-apps-in-toss.toss.im/bedrock/reference/framework/%EA%B4%91%EA%B3%A0/IntegratedAd.html): 개발 시 공식 테스트 광고 ID 사용.
