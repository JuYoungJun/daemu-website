# Resend 이메일 통합 — 운영 가이드

## 1. 현재 상태

| 항목 | 상태 |
|---|---|
| 백엔드 발송 함수 (`send_via_resend`) | ✅ 구현 완료 (`backend-py/main.py:776`) |
| `RESEND_API_KEY` 환경변수 | ⏳ 사용자 등록 대기 |
| 도메인 verify (SPF/DKIM/DMARC) | ⏳ 도메인 확보 후 진행 |
| `FROM_EMAIL` | 기본값 `DAEMU <onboarding@resend.dev>` (테스트용) |
| SMTP fallback (Gmail) | ✅ 백업으로 사용 가능 |
| 어드민 로그인 이메일 OTP | ⏳ 본 가이드의 §3 참고 (스캐폴딩 완료) |
| 단체메일 (bulk send) | ✅ 본 가이드의 §4 참고 (가능, 도메인 verify 필수) |

## 2. 키 발급 + 도메인 verify 절차

1. **가입**: https://resend.com/signup (Google/GitHub OAuth 가능)
2. **API Key 생성**:
   - Dashboard → API Keys → "Create API Key"
   - 권한: `Sending access` (production용은 도메인 단위 제한 권장)
   - 키 형식: `re_XXXXXXXX_XXXXXXXXXXXXXXXXXXXX`
   - **이 키를 절대 커밋하지 말 것** — Render Secret 또는 카페24 `/etc/daemu-api.env`에만 등록
3. **도메인 추가**:
   - Dashboard → Domains → "Add Domain" → `daemu.co.kr` 입력 (예시)
   - Resend가 4개 DNS 레코드 표시 (SPF, DKIM ×2, DMARC)
   - **카페24 DNS 콘솔 → 도메인 → DNS 관리** 에서 TXT 4건 등록
   - 카페24는 보통 5~30분 내 전파, Resend가 자동 verify
4. **`FROM_EMAIL` 변경**:
   - `.env`의 `FROM_EMAIL=DAEMU <noreply@daemu.co.kr>` 로 교체
   - 이전: `onboarding@resend.dev`는 테스트 발신만 가능, **실제 운영 도메인 메일 발송 불가**

## 3. 비용 (2026-04 기준 — 변동 가능)

| 플랜 | 월 비용 | 발송 한도 | 일 한도 | 도메인 |
|---|---|---|---|---|
| **Free** | $0 | 3,000건/월 | 100건/일 | 1개 verify |
| Pro | $20 | 50,000건/월 | 무제한 | 10개 |
| Scale | $90 | 100,000건/월 | 무제한 | 50개 |
| Enterprise | 협의 | 협의 | 협의 | 협의 |

- 데모/QA 단계 = Free 충분 (월 3,000건은 주 100건 가까움)
- 어드민 OTP만으로는 절대 free 한도 초과 안 됨
- 단체메일(파트너 100명 + 뉴스레터 200명)을 매주 보낸다 = Pro 필요

## 4. 어드민 로그인 이메일 OTP (B1)

### 동작 흐름

```
1. 관리자 → /admin/login → 이메일+비밀번호 입력
2. (옵션) 백엔드: 6자리 코드 생성, 이메일로 발송 (Resend 사용)
3. 관리자 → 받은 코드 입력
4. 백엔드: 코드 검증 → JWT 발급
```

### 백엔드 스캐폴딩

- **테이블**: `admin_email_otp` (id, user_id, code_hash, expires_at, used_at, ip)
- **엔드포인트**: `POST /api/auth/email-otp/send` `POST /api/auth/email-otp/verify`
- **TTL**: 5분, **재발송 쿨다운**: 60초, **시도 제한**: 5회 후 lock 15분
- **현재 구현 위치**: 본 PR의 `backend-py/main.py` 인근 (스캐폴딩 only — 도메인 verify 후 활성화)

### 활성화 조건

`AUTH_EMAIL_OTP_ENABLED=true` 환경변수 + `RESEND_API_KEY` 설정 둘 다 있어야 활성화.

## 5. 단체메일 (Bulk send)

Resend는 **`/emails/batch` API** 로 최대 100건/요청 단체 발송 지원.
공식 docs: https://resend.com/docs/api-reference/emails/send-batch-emails

### 백엔드 동작

- `POST /api/admin/mail/send-bulk` `{ template_id, recipients: [{email, vars}], subject_override? }`
- 100건씩 chunk 분할 → Resend batch API 호출
- 결과를 `outbox` 테이블에 1건씩 기록 (성공/실패 누적)
- **개인정보 BCC 누설 방지**: 항상 `to: [recipient]` 단건으로, 절대 단일 메일에 다수 to/cc 안 묶음

### 어드민 UI (예정)

- `/admin/mail` 에서 "템플릿 + 수신자 목록 + 변수" 선택 → 발송
- 본 PR에서는 **여러 템플릿 저장** 기능까지만 추가됨 (단체발송 UI는 도메인 verify 이후)

## 6. 발송 실패 시 대응

`AdminMonitoring` 페이지가 자동으로 모니터링:
- 5분 내 5건 이상 실패 → CRITICAL 등급
- 24시간 내 누적 실패 → HIGH

`Outbox` 페이지에서 개별 발송 이력 + 실패 사유 확인.

## 7. 보안 체크리스트 (운영 전)

- [ ] `RESEND_API_KEY`는 카페24 VPS의 `/etc/daemu-api.env`에만 보관 (퍼미션 600)
- [ ] `FROM_EMAIL`은 verify된 도메인만 사용 (스푸핑 방지)
- [ ] **`AUTH_EMAIL_OTP_ENABLED` 기본값은 `false`** — 미설정 시 OTP 라우터가 fail-closed로 503 반환
- [ ] DMARC 정책 `p=quarantine` 이상 설정 (`v=DMARC1; p=quarantine; rua=mailto:dmarc@daemu.co.kr`)
- [ ] SPF / DKIM TXT 레코드 정확히 등록 (Resend dashboard에서 verify 표시 확인)
- [ ] **OTP 발송 한도 (강제)**: IP당 분당 5회, 사용자당 시간당 6회 — token-bucket으로 백엔드에서 강제. AdminEmailOtp에 `last_sent_at`, `locked_until` 컬럼이 있어야 함.
- [ ] **OTP 코드 cleartext 비로깅**: send 핸들러 디버그 로그·outbox·error trace 어디에도 `code` 평문이 남지 않도록 (`src/lib/api.js`의 `redactForLog` 정책을 백엔드도 미러링).
- [ ] **OTP 메일 본문 안내**: 발신 IP, 디바이스 요약, 발송 시각, "본인이 요청하지 않은 경우" 안내 + DAEMU 운영 연락처 포함 (PIPA 안내 문구).
- [ ] **TOTP 활성 사용자에게는 이메일 OTP 트리거 거부** — 이중 OTP는 약한 채널이 우회로가 되므로. `if user.totp_enabled: 거부` 코드로 강제. (단, recovery code 분실 시 운영자 수동 임시 발급 절차는 별도 SOP)
- [ ] **bounce/complaint webhook 보호**: `https://api.daemu.co.kr/hooks/resend` 등록 시 Resend 서명(`resend-webhook-signature`) 검증 필수. 서명 검증 실패 시 200 무응답이 아니라 401 반환.
- [ ] **`FROM_EMAIL` 도메인 화이트리스트**: 코드에서 verify된 도메인 목록을 env로 받아, 다른 도메인 발송 시도 시 거부.
- [ ] **메일 본문 변수 escaping**: `{{var}}` 치환이 HTML 컨텍스트일 때 server-side에서 `<>&"`'를 escape. plain text 컨텍스트에서는 줄바꿈·탭만 정규화.
- [ ] 어드민 이메일 OTP는 **TOTP가 비활성화된 사용자만** 트리거 (이중 OTP 방지)
- [ ] 모든 발송에 unsubscribe 헤더 + 링크 (마케팅 메일만 — 트랜잭션 메일은 면제)
- [ ] 신규 도메인은 처음 4주는 발송량을 점진적으로 늘려야 reputation이 올라감 (warmup)
- [ ] **PIPA 처리방침 갱신**: AdminEmailOtp/SuspiciousEvent/AuditLog 활성화와 동시에 사이트 처리방침 페이지에 "수집 항목, 목적, 보존기간(90/365일), 파기 절차" 명시.
