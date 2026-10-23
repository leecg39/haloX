# 구독·결제 구현 및 검증

기준일: 2026-10-24

## 제공 기능

- `/app/settings?tab=plan`: 현재 플랜, 네 가지 실시간 사용량, 플랜 가격, 구독 상태를 표시한다.
- `/app/settings?tab=billing`: 위 정보와 결제 수단, 결제 내역, 영수증, 세금계산서 문의 경로를 표시한다.
- 워크스페이스 소유자와 관리자만 카드 등록·삭제, 구독 시작·변경·해지·철회, 거래 조회, 전액 취소를 실행한다. 다른 멤버는 조회만 할 수 있다.
- 유료 플랜 가격과 한도는 서버의 `plan_templates`, `plan_unit_limits`에서 결정한다. 브라우저가 전달한 금액이나 한도는 사용하지 않는다.
- 카드 등록은 NicePay 빌링키 발급 API를 사용한다. 카드번호·유효기간·생년월일 또는 사업자번호·카드 비밀번호 앞 2자리는 요청 처리 중 AES-256-CBC 암호문으로 바뀌며 HaloX 저장소에는 남지 않는다. 발급된 빌링키는 `HALOX_INTEGRATION_SECRET` 또는 `HALOX_SESSION_SECRET`에서 파생한 AES-256-GCM 키로 다시 암호화해 비공개 저장소에 보관한다.
- 최초 결제, 플랜 변경, 자동 갱신은 서로 다른 영구 주문번호와 요청 키를 사용한다. 외부 요청 중에는 SQLite 쓰기 잠금을 잡지 않는다.
- 응답 금액·주문번호·거래번호·상태·SHA-256 서명을 검증한 뒤에만 구독과 한도를 활성화한다.
- 응답 유실이나 타임아웃은 `unknown`으로 기록하며 자동 재결제하지 않는다. 기존 주문번호 조회로만 정산한다.
- 기간 종료 해지는 다음 갱신을 중지하고, 철회하면 같은 구독을 유지한다. 마지막 결제 전액 취소가 확인되면 즉시 Trial로 전환한다.
- 결제 웹훅은 서명, 금액, 주문번호, 거래번호를 다시 검증한다. 중복 통보는 멱등 처리하며 취소된 주문에 늦게 도착한 과거 `paid` 통보는 구독을 되살리지 않는다.
- 정기결제 작업자는 만료된 활성 구독을 한 번만 점유한다. 같은 기간 키는 재시작·복수 프로세스에서도 다시 청구하지 않는다. 확정 실패 시 Trial로 전환하고, 불명확한 결과는 운영자 확인 대상으로 남긴다.
- `orders`, `subscriptions`, `billing_payment_methods`, `workspace_plans`, `workspace_billing_overrides`는 공개 REST에서 읽기 전용이다. 기존 `nicepay-*` 모의 함수는 전용 API 사용 오류를 반환한다.
- 활성 구독·카드나 확인되지 않은 결제가 있는 워크스페이스는 계정 탈퇴 대상이 될 수 없다. 먼저 해지·거래 확인·카드 삭제가 필요하다.

## NicePay 공식 계약

구현은 NicePay의 다음 공식 자료를 기준으로 했다.

- [API·JS SDK 및 인증](https://github.com/nicepayments/nicepay-manual/blob/main/common/api.md): 고정 운영/샌드박스 API 주소와 Basic 인증.
- [빌링키 발급·승인·삭제](https://github.com/nicepayments/nicepay-manual/blob/main/api/payment-subscribe.md): `/v1/subscribe/regist`, `/v1/subscribe/{bid}/payments`, `/v1/subscribe/{bid}/expire` 및 AES 암호화 방식.
- [취소·환불](https://github.com/nicepayments/nicepay-manual/blob/main/api/cancel.md): `/v1/payments/{tid}/cancel`과 취소 성공 코드.
- [결제 웹훅](https://github.com/nicepayments/nicepay-manual/blob/main/api/hook.md): 서명 검증, `OK` 응답, 결제·취소 통보.
- [개발 준비와 타임아웃](https://github.com/nicepayments/nicepay-manual/blob/main/common/preparations.md): 운영/샌드박스 키 분리, TLS, 고정 도메인, read timeout 후 결과 불일치 방지.

## 서버 설정

```dotenv
NICEPAY_CLIENT_KEY=
NICEPAY_SECRET_KEY=
NICEPAY_MODE=sandbox
HALOX_INTEGRATION_SECRET=
```

`NICEPAY_SECRET_KEY`는 빌링키 발급의 AES-256 `A2` 모드에 맞는 32바이트 키여야 한다. 운영에서는 NicePay 관리자에 다음 HTTPS 웹훅을 등록한다.

```text
https://<서비스 도메인>/api/v1/billing/webhook
```

샌드박스와 운영 키는 서로 바꿔 쓸 수 없다. 운영 전에는 NicePay 관리자에서 서버 송신 IP를 제한하고, 웹훅 인바운드 대역을 방화벽에서 NicePay 공식 대역으로 제한한다. 실제 키가 없으면 화면은 조회 전용 안내를 표시하고 카드 등록·결제 버튼을 비활성화한다.

## 검증

- `src/lib/backend/billing.test.ts`: 카드 원문·빌링키 비저장, 서버 가격, 영구 요청 키, 테넌트·관리자 권한, 원장 직접 쓰기 차단, 응답 유실 후 조회, 전액 취소, 카드 삭제, 웹훅 중복·역순 방어, 재시작·복수 작업자 갱신, NicePay 고정 주소·AES 암호문·서명 검증.
- `e2e/billing.spec.ts`: 저장된 Pro 구독·마스킹 카드·결제 내역 표시, 해지 예약과 철회, 외부 Origin 차단, 원장 REST 차단, 390px 모바일 폭과 본문 스크롤.
- 기존 사용량 여정 `e2e/settings.spec.ts`도 새 플랜 화면에서 네 가지 실시간 수치를 계속 확인한다.
- 단위 테스트 332/332, 백엔드 계약 22/22, 전체 E2E 109/109, 타입 검사와 프로덕션 빌드, 경로 363개 검증을 통과했다. 실제 NicePay 요청과 운영 결제는 자격 증명이 없는 상태에서 실행하지 않았으며 제공사 대역으로 계약을 검증했다.

## 운영상 제한

- NicePay 관리자 취소나 네트워크 경계의 결과는 웹훅 또는 거래 조회가 도착하기 전까지 `unknown`일 수 있다. 이 상태에서 새 결제는 차단한다.
- 부분 취소 통보는 원장 잔액을 반영하지만 화면의 직접 명령은 현재 구독의 마지막 결제 전액 취소만 제공한다.
- 세금계산서 자동 발행은 구현하지 않았다. 기존 피드백 접수함으로 문의를 남긴다.
