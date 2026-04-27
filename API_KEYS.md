# API 키 발급 & 적용 가이드

이 사이트는 **백엔드 + 이메일 서비스** 조합으로 작동합니다. 데모 단계에서는 백엔드 없이도 동작하며, 모든 발송은 `/admin/outbox`에 시뮬레이션으로 기록됩니다.

## 0. 사전 준비

```bash
cp .env.example .env
# .env를 열어 백엔드 URL 입력 (백엔드 준비 완료 후)
```

`.env` 변경 후엔 반드시 재빌드:
```bash
npm run build && npm run preview
```

---

## 1. 이메일 서비스 — Resend (권장)

**왜 Resend인가**:
- 가장 모던한 이메일 API (2023년 출시, 빠르게 사실상 표준)
- 무료 3,000건/월
- React Email 통합 (HTML 템플릿을 React 컴포넌트로 작성 가능)
- Webhook으로 delivered/opened/clicked/bounced 이벤트 추적
- 깔끔한 한 줄 SDK

**가입 & 키 발급**:

### 1단계: 회원가입
https://resend.com → 무료 계정 생성

### 2단계: 도메인 인증 → DNS TXT/MX 레코드 등록
**Domains → Add Domain** → 도메인 입력 → 표시되는 DNS 레코드를 도메인 등록업체(카페24 등)에 추가

> 도메인이 아직 없다면 → `onboarding@resend.dev`를 발신자로 사용 가능 (테스트 한정, 배포 전까지)

### 3단계: API Key 발급 → 백엔드에 등록
**API Keys → Create API Key**
- Permission: **Sending access**
- 키 복사 (`re_xxxxxxxxxxxxxxxxx` 형태)

이 키는 **백엔드 환경변수**에 저장 (브라우저에 절대 노출 X).

### 4단계: 백엔드 배포

`backend-reference/README.md` 참고. 권장 조합:

| 옵션 | 비용 | 셋업 시간 | 비고 |
|---|---|---|---|
| **Cloudflare Workers + Resend** | $0 | 5분 | ⭐ 가장 추천 |
| Vercel Functions + Resend | $0 | 10분 | Vercel 사용자에게 좋음 |
| 카페24 클라우드 베이직 + Express | ₩11k/월 | 30분 | 호스팅 강제 시 |

배포 후 받은 URL을 사이트 `.env`에 등록:
```env
VITE_API_BASE_URL=https://daemu-api.your-subdomain.workers.dev
```

---

## 2. 이메일 서비스 대안

| 서비스 | 무료 | 추천 시기 |
|---|---|---|
| **Resend** ⭐ | 3,000/월 | 기본 추천. 깔끔한 DX |
| **Brevo** (구 Sendinblue) | 300/일 영구 | 한국 + SMS·마케팅까지 통합 운영 |
| **MailerSend** | 3,000/월 | Resend 대안. 템플릿 빌더 강함 |
| **SendGrid** | 100/일 영구 | Twilio 생태계 (SMS·WhatsApp) 같이 쓸 때 |
| **AWS SES** | 200/일 (EC2) + $0.10/1k | 월 5만건 이상 대량 발송 |

코드 변경은 백엔드 한 군데(`backend-reference`의 sender 부분)만 바꾸면 됩니다. 프론트엔드는 동일.

---

## 3. (선택) Plausible Analytics

**도메인 필수**. 도메인 없이는 사용 불가.
- 도메인이 아직 없다면 → `VITE_PLAUSIBLE_DOMAIN`을 비워두세요. 사이트는 정상 동작, 분석만 OFF.
- 도메인 생기면 한 줄 추가하면 끝.

**가입 옵션**:
- Plausible Cloud: https://plausible.io (월 $9~)
- Umami self-host: https://umami.is (Docker 1분 셋업, 무료)

```env
VITE_PLAUSIBLE_DOMAIN=daemu.kr
```

---

## 4. 이미지 / 동영상 처리

**외부 CDN 사용 안 함**. 클라이언트 측 처리:
- `browser-image-compression` 라이브러리로 자동 리사이즈(1920px 캡) + JPEG 재인코딩
- Web Worker에서 처리 → UI 멈춤 없음
- 결과는 base64 데이터 URL로 localStorage 저장
- SVG / GIF는 통과

**키 발급 불필요**.

운영하면서 이미지가 100장 이상 쌓이면 그때 Cloudflare R2 / Cloudinary 도입 고려.

---

## 5. 데모 단계 운영 (백엔드 없이)

`VITE_API_BASE_URL`이 비어 있으면:
1. Contact 폼 제출 / 어드민 자동회신 / 캠페인 / 계약서 발송 모두 **시뮬레이션**
2. **`/admin/outbox`** 페이지에서 어떤 메일이 어떻게 나갈지 실제 동작 그대로 확인 가능
3. 수신자, 제목, 본문, 시간 모두 기록됨
4. 백엔드 배포 후 `.env`에 URL만 등록하면 동일 흐름이 실제 발송으로 전환

---

## 6. 적용 후 확인 체크리스트

`.env`에 `VITE_API_BASE_URL` 등록 후:

| 검증 항목 | 방법 |
|---|---|
| 자동회신 | http://localhost:8765/contact 폼 제출 → /admin/outbox 에서 `sent` 상태 확인 + 받은편지함 |
| 어드민 캠페인 | /admin/campaign → 새 캠페인 → "지금 발송" → /admin/outbox 결과 확인 |
| 어드민 답변 메일 | /admin/inquiries → 회신 메모 작성 → 상태 "답변완료" → 발송 확인 |
| 발주 계약서 | /admin/orders → 계약서 본문 작성 → 저장 → "계약서 발송" → 파트너 메일함 |
| 자동회신 테스트 | /admin/mail → "테스트 발송" → 본인 이메일 확인 (변수 치환됐는지) |

---

## 7. 보안 메모

- **`.env`는 git에 커밋 금지** (`.gitignore`에 등록됨)
- **Resend API 키는 백엔드 환경변수에만** 저장 — 브라우저 노출 시 즉시 폐기
- 백엔드 CORS는 운영 도메인 + localhost만 허용
- Resend Webhook 시크릿으로 이벤트 콜백 검증 (대량 발송 시)
- 운영 환경 배포 시 GitHub Secrets에도 동일하게 등록
