# DAEMU 보안 감사 보고서 (2026-04-30, 2026-05-01 갱신)

> 운영 배포(Cafe24 VPS) 직전 검토. 대상: backend-py + src/admin + 운영 정책.
> 보고 형식: CLAUDE.md 의 control-tower 분류 + OWASP Top 10 매핑.

## 요약

| 등급 | 건수 | 상태 (2026-05-01 갱신) |
|---|---|---|
| Critical | **2** | F-1 ✅ 수정 / F-2 사용자 작업 필요 |
| High     | **4** | F-3 ✅ 수정 / F-4 사용자 / F-5 사용자 / F-6 사용자 |
| Medium   | **6** | F-7 ✅ wired / F-8 ✅ sweep 추가 / 그 외 V2 |
| Low / Informational | **5** | 모두 V2 |

**즉시 수정 적용 (누적)**: 5건
- F-1 이메일 발송 signature
- F-3 IP 정책 통일
- F-7 SuspiciousEvent wired (login throttle → brute_force_login)
- F-8 audit_logs / suspicious_events retention sweep cron
- (신규) `routes_crud.py` 의 자동회신이 `send_email` 유니파이드 라우팅 → SMTP fallback 자동 적용

**사용자 검토 권고**: 14건 (env 설정·운영 절차 위주).

**운영 배포 차단 항목**:
1. `JWT_SECRET` 미설정 (env) — 매 deploy 마다 모든 세션 invalidate.
2. 기본 시드 비밀번호 (admin/tester/dev1234, DEMO_SUPERADMIN_PASSWORD 하드코딩) — `ENV=prod` 설정 + 비밀번호 교체 전 GO 금지.
3. `DAEMU_MYSQL_SSL_DISABLE=1` 또는 `MYSQL_SSL_CA` 미설정 시 SSL verify 우회 — Aiven CA PEM 등록 후 GO.
4. `RESEND_API_KEY` 미설정 시 contact 자동회신 simulated → 실제 고객 응대 끊김.

**가장 위험한 finding 1줄**: routes_email_verify 의 send_email() 호출이 잘못된 시그니처로 호출돼 **이메일 인증 코드가 실제로 발송되지 않고 있던** 상태였음 (수정 적용 — F-1).

---

## Critical findings

### F-1 [수정 완료] 첫 접속 이메일 인증 코드 발송 불능
- 위치: `backend-py/routes_email_verify.py:272`
- 위험: `send_email(to_email=..., to_name=..., subject=..., body=..., html=None)` 호출이 `main.send_email(payload: dict)` 시그니처와 불일치 → 모든 실 발송 호출에서 `TypeError`. except 가 swallow → 호출자에게는 정상 처리된 것처럼 보이고, 사용자는 코드를 받지 못해 어드민 첫 로그인 자체가 막힘.
- 권장 조치: dict payload 로 변경. 적용함.
- OWASP: A04:2021 Insecure Design (계약 불일치).

### F-2 JWT_SECRET 미설정 → 토큰 휘발 + 잠재 공격 표면
- 위치: `backend-py/auth.py:189-195`
- 위험: env 미설정 시 `secrets.token_hex(32)` 로 매 부팅 fresh secret. 모든 세션이 deploy 때 invalid 화 → 가용성 저하 + replay/keep-alive 시나리오에서 프로세스 메모리 secret 고정. forensic / multi-instance 환경에서 secret 다중 분기.
- 권장 조치: Cafe24 systemd EnvironmentFile 또는 `/etc/daemu/.env` 에 `JWT_SECRET=$(openssl rand -hex 32)` 등록 후 GO. 코드는 미설정 시 운영(`ENV=prod`)에서 **fail-closed (RuntimeError)** 로 강화 권장.
- 즉시 수정 가능: yes (운영 정책 결정 필요해 미적용 — 보고서 권장)
- OWASP: A02:2021 Cryptographic Failures.

---

## High findings

### F-3 [수정 완료] audit.py / auth.py 의 X-Forwarded-For 정책 불일치
- 위치: `backend-py/audit.py:23-31`
- 위험: auth.py 는 `TRUST_FORWARDED_FOR` env 토글 + 마지막 항목(rightmost) 사용. audit.py 는 토글 무시 + 무조건 마지막 항목. Cafe24 VPS 직접 배포 시 `TRUST_FORWARDED_FOR=0` 으로 운영하면 throttle 키와 audit IP 가 어긋나서 forensic 추적 시 IP 불일치.
- 권장 조치: audit.py 의 `_client_ip` 가 auth.py 의 함수를 위임 호출하도록 수정. 적용함.
- OWASP: A09:2021 Security Logging Failures.

### F-4 디폴트 시드 비밀번호 + 데모 슈퍼관리자 fallback
- 위치: `backend-py/auth.py:111-115` (admin/tester/dev1234), `backend-py/seeds.py:594` (`DEMO_SUPERADMIN_PASSWORD = "Daemu@Test2026Final!"`)
- 위험: `ENV=prod` 미설정 시 매 부팅마다 알려진 비밀번호로 superadmin 자동 복원. `ensure_default_users` 의 weak default 시드도 동일.
- 권장 조치: Cafe24 마이그레이션 직후 **반드시** `ENV=prod` 설정 + `ADMIN_PASSWORD/TESTER_PASSWORD/DEVELOPER_PASSWORD` 모두 강한 비밀번호로 교체 + `TEST_ADMIN_*` env 미설정 확인. seeds.py 의 데모 fallback 은 ENV=prod 에서 자동 skip 되지만, env 누락 시 위험. systemd unit 의 `Environment=ENV=prod` 강제 권장.
- OWASP: A07:2021 Identification and Authentication Failures.

### F-5 [수정 완료] `DAEMU_RESET_TOTP_EMAIL` env 기반 reset 제거 (호스트 종속 + backdoor 위험)
- 위치: `backend-py/main.py:224-240`
- 위험: env 등록되어 있는 한 매 부팅마다 해당 사용자 2FA reset. 운영자가 사용 후 즉시 삭제 안 하면, 침입자가 env 를 그대로 두고 패스워드만 reset 하면 어드민 우회.
- 권장 조치: 코드에 "1회 사용 후 자동 disarm" 패턴 추가 — reset 성공 시 `DAEMU_RESET_TOTP_USED_AT` 같은 marker 를 audit log 에 남기고, 동일 부팅이 다음 부팅에 fail-closed (env 가 여전히 있으면 RuntimeError). 또는 systemd `EnvironmentFile=` 에서 사용 후 즉시 삭제하는 운영 절차 README 명시.
- OWASP: A01:2021 Broken Access Control.

### F-6 `MYSQL_SSL_CA` 미설정 시 SSL verify 우회
- 위치: `backend-py/db.py:102-110`
- 위험: 현재는 `CERT_NONE` 으로 자동 fallback — 운영 환경에서 MITM 공격에 노출. 무엇보다 Aiven 의 self-signed CA 는 콘솔에서 즉시 받을 수 있어 등록 안 할 이유가 없음.
- 권장 조치: `ENV=prod` 일 때 CA 미설정이면 RuntimeError fail-closed. 코드 수정은 운영 정책 합의 후. README 에 Aiven CA PEM 복사 절차 명시 (deploy/cafe24/README 에 포함 권장).
- OWASP: A02:2021 Cryptographic Failures.

---

## Medium findings

### F-7 [수정 완료] SuspiciousEvent 모듈은 정의됐지만 wired 안 됨
- 위치: `backend-py/suspicious.py` (정의), 호출처 0건.
- 위험: `record()` 가 어디에서도 호출되지 않아 brute force / unauthorized admin / abnormal payload 패턴이 DB 에 기록되지 않음. sweep cron 도 lifespan 에 미등록.
- 권장 조치:
  1. `auth.py login.failure` 에서 `_login_throttle.is_locked` 임계 도달 시 `record(reason="brute_force_login", severity="high")` 호출.
  2. `routes_pdf` / `routes_documents` 의 401/403 대량 발생 시 `unauthorized_admin_attempt`.
  3. `_retention_cron` 에 `from suspicious import sweep_expired` 호출 추가.
- OWASP: A09:2021 Security Logging Failures.

### F-8 [수정 완료] audit_logs / suspicious_events retention 자동 sweep 부재
- 위치: `backend-py/main.py:_retention_cron` (Inquiry/Outbox 만)
- 위험: PIPA 제29조는 ≥1년 보존 요구. 5년 초과 시 자동 정리 없음 → DB 비대화 + 보존 한도 정책 위반(반대 방향).
- 권장 조치: `_retention_cron` 에 `cutoff_audit = now - timedelta(days=int(os.environ.get("AUDIT_RETENTION_DAYS","1825")))` 분기 추가. 기본 5년.
- OWASP: A09:2021.

### F-9 RawPage / AdminLayout 의 dangerouslySetInnerHTML
- 위치: `src/components/RawPage.jsx:19`, `src/components/AdminLayout.jsx:18`
- 위험: 현재는 trusted 하드코딩 HTML 만 받지만, 향후 admin 텍스트가 untrusted 소스에서 들어오면 stored XSS. AdminLayout 은 dead code 라 즉시 위험은 아님.
- 권장 조치: AdminLayout 사용처 0건이므로 삭제. RawPage 의 `html` 인자에 항상 server-controlled HTML 만 들어가는지 정적 분석.
- OWASP: A03:2021 Injection.

### F-10 `/api/upload` 의 `MAX_VIDEO_BYTES=50MB` Cafe24 VPS 메모리 위험
- 위치: `backend-py/main.py:81`
- 위험: base64 → bytes 디코드는 단일 메모리 buffer. 동시 다수 업로드 시 1vCPU 1GB Cafe24 인스턴스에서 OOM 가능 (50MB × 4 ≈ 200MB + 디코드 임시 + Resend payload).
- 권장 조치: nginx 에서 `client_max_body_size` 로 1차 차단(권장 25MB), backend 는 streaming upload 로 전환(`UploadFile` chunked + magic byte 시 stream 검사) 향후 권장. 단기엔 동시 업로드 cap (semaphore 4) 추가.
- OWASP: A05:2021 Security Misconfiguration.

### F-11 routes_geo 의 외부 API 호출 미인증 + DoS 가능성
- 위치: `backend-py/routes_geo.py:62-83`
- 위험: ipapi.co 무료 1000 req/day. require_perm("analytics","read") 로 보호되어 있지만 admin 토큰만 있으면 batch 50 IP 호출 가능 → 일일 한도 빠르게 소진. 캐시 1시간이 완화하지만 cache miss 폭주 시 외부 API 빈번 호출.
- 권장 조치: 어드민 호출에도 IP 단위 rate limit (예: 10/분) 추가. 외부 API 응답을 DB 컬럼 (CrmCustomer.geo_cache 등) 으로 영속화하면 더 안전.
- OWASP: A04:2021.

### F-12 Public sign endpoint 의 token 고정 길이 검증 부재
- 위치: `backend-py/routes_documents.py:491,523`
- 위험: `len(token) < 16` 만 검사 — 정상 토큰은 `secrets.token_urlsafe(32)` (≈43자). 매우 짧은 토큰이 DB 에 들어갈 일은 없지만, 공격자가 16~30자 brute force 시도를 할 수 있어 audit log spam 위험.
- 권장 조치: `not 32 < len(token) < 64` 보다는 정확히 `len(token) == 43` 로 좁힘. 추가로 invalid token 5회 시 IP 단위 throttle.
- OWASP: A07:2021.

---

## Low / Informational

### F-13 DEMO_SUPERADMIN_PASSWORD 가 코드에 평문 하드코딩
- 위치: `backend-py/seeds.py:594`
- 위험: 공개 git history 에 검색 가능. 데모/dev 전용이지만 검색 엔진/Github code search 노출.
- 권장 조치: 비밀번호 자체를 코드에서 제거하고 env 미설정 시엔 시드를 skip. README 에 dev 환경 비밀번호 안내.

### F-14 `LEGACY_KEY` 토큰 마이그레이션 잔재
- 위치: `src/lib/auth.js:30-43`
- 위험: 옛 sessionStorage 토큰 → localStorage 마이그레이션. 마이그레이션이 끝났으면 LEGACY_KEY 분기 제거. 남아있으면 향후 토큰 storage 정책 변경 시 혼란.
- 권장 조치: 사용자 baseline 확정 후 정리.

### F-15 CSP `script-src 'unsafe-inline'`
- 위치: `backend-py/main.py:409`
- 위험: /docs Swagger UI 가 inline script 사용. unsafe-inline 은 XSS 방어 약화. API 응답에는 영향 없으나 운영 단계에서 /docs 비활성(`ENV=prod`) 후엔 nonce 기반으로 강화 가능.
- 권장 조치: `ENV=prod` 시 CSP 도 unsafe-inline 제거 분기. 코드 수정은 정책 합의 후.

### F-16 `_PENDING_TASKS` set 무제한 성장 가능성
- 위치: `backend-py/routes_crud.py:92`
- 위험: fire-and-forget 자동회신 task 가 add_done_callback 으로 정리되지만, 발송이 timeout(15s) 누적되면 동시 N건이 메모리 점유. Cafe24 1GB 메모리에선 의미 있는 압박.
- 권장 조치: `asyncio.Semaphore(8)` 으로 동시 발송 cap.

### F-17 PIPA 처리방침 항목 vs 코드 일관성 문서 부재
- 위치: 코드 전체 (audit_logs, suspicious_events, short_link_clicks, inquiries)
- 위험: 보존 기간/수집 항목/3자 제공 등 처리방침에 명시해야 하는데 코드에 산재된 정책이 한 곳에 정리돼 있지 않음.
- 권장 조치: `docs/PIPA_POLICY.md` 1장 생성 — 사이트 처리방침 페이지와 1:1 매칭.

---

## Cafe24 마이그레이션 직전 체크리스트

운영자가 GO 직전에 한 번 다 체크해야 합니다.

- [ ] **`ENV=prod`** 가 systemd EnvironmentFile 에 명시.
- [ ] **`JWT_SECRET`** 64자 hex 등록 (재배포해도 유지).
- [ ] **`ADMIN_PASSWORD/TESTER_PASSWORD/DEVELOPER_PASSWORD`** 모두 강한 비밀번호로 교체. 기본값 미사용 확인.
- [ ] **`TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD`** env 미설정 (있으면 ENV=prod 가 RuntimeError 로 보호하지만 확인 필요).
- [ ] **`MYSQL_SSL_CA`** Aiven 콘솔의 CA PEM 등록.
- [ ] **`DAEMU_MYSQL_SSL_DISABLE`** 환경변수 미설정 확인.
- [ ] **`DAEMU_RESET_TOTP_EMAIL`** 환경변수 미설정 확인 (1회 사용 후 즉시 제거).
- [ ] **`SHORT_LINK_HMAC_SECRET`** 64자 hex 등록 (QR 단축 링크 위변조 방지).
- [ ] **`RESEND_API_KEY`** 또는 `SMTP_*` 셋업 — `/api/health` 의 `emailProvider` 가 `none` 이 아닌지.
- [ ] **`ALLOWED_ORIGINS`** 운영 도메인 만 (개발 localhost 제거).
- [ ] **`PUBLIC_BASE_URL`** 운영 도메인 (uploads URL 생성에 사용).
- [ ] **`SHORT_LINK_BASE`** 운영 도메인 (`https://daemu.kr/r/`).
- [ ] **`TRUST_FORWARDED_FOR`** Cafe24 nginx 사용 시 `1` (default), 백엔드 직접 노출 시 `0`.
- [ ] **`INQUIRY_RETENTION_DAYS=1095`** (3년) / **`OUTBOX_RETENTION_DAYS=365`** / **`SUSPICIOUS_RETENTION_DAYS=90`** 확인.
- [ ] **HSTS / CSP / nosniff / Frame-DENY 헤더** 가 nginx 응답에서 보이는지 (백엔드 미들웨어 + nginx 양쪽).
- [ ] **DB 백업 cron** Cafe24 서버에서 매일 mysqldump → S3/외부 스토리지 (RTO 1h, RPO 24h).
- [ ] **secret rotation 정책** 최초 6개월 후 JWT_SECRET / SHORT_LINK_HMAC_SECRET 1회 rotate (운영 캘린더 등록).
- [ ] **audit_logs retention cron** 활성화 (F-8).
- [ ] **PII 삭제 요청 처리 흐름** 검증 — 사용자가 `/privacy` 페이지에서 요청 시 즉시 처리되는 admin UI 확인.
- [ ] **`/admin/security` 페이지** 가 `ENV=prod` 후에도 정상 동작 (suspicious_events / audit_logs 수집).
- [ ] **`/api/auth/login` IP throttle** 5회/15분 유지되는지 검증 (Render 의 `_login_throttle._fails` 가 multi-instance 에선 분산 안 됨 — 단일 worker 권장).
- [ ] **`/docs`, `/redoc`, `/openapi.json`** 비활성 확인 (`ENV=prod` 시 코드가 None 으로 설정).
- [ ] **uvicorn `--workers 2`** + `pool_size`/`max_overflow` 설정 검토 (Aiven 5 connection 한도 고려해 `pool_size=2` 추천).

---

## 변경 적용 파일 (누적)

### 1차 (2026-04-30)
- `backend-py/routes_email_verify.py:248-284` — `send_email` 호출을 dict payload 로 수정 (F-1).
- `backend-py/audit.py:23-32` — `_client_ip` 가 auth.py 의 정책을 위임 호출하도록 통일 (F-3).

### 4차 (2026-05-01 — 2FA 복구 host-agnostic)
- **F-5 fix**: `DAEMU_RESET_TOTP_EMAIL` env 기반 lifespan reset 코드 제거.
  호스트별로 env 등록/삭제 절차가 달라(Render Dashboard vs Cafe24 systemd
  EnvironmentFile + restart) 운영자 실수 + backdoor 위험. 대신:
  - **이메일 복구 링크** (`POST /api/auth/totp-reset-request` + `confirm`)
    — 5분 TTL JWT, 1회용. 로그인 화면 "2단계 인증 분실?" 링크.
  - **CLI 비상 도구** (`backend-py/manage.py reset-2fa --email <email>`)
    — host shell 에서 1회 실행, audit_logs 에 actor='cli' 기록.
  - 둘 다 host 무관 (Render shell / Cafe24 ssh / 로컬 dev 동일).
- 신규 frontend 페이지: `src/admin/TotpResetConfirm.jsx` (`/admin/totp-reset?token=...`).
- 신규 backend endpoint 2개 (총 routes 132 → 134).

### 3차 (2026-05-01 — 호스팅 중립화)
- 백엔드/프론트의 Render 특화 주석/메시지/URL 제거 — Cafe24 자체 호스팅
  마이그레이션 시 자연스럽게 동작하도록 호스팅-agnostic 으로 정리:
  - `backend-py/db.py` 모듈 docstring (예시 URL)
  - `backend-py/main.py` SwaggerUI prod 코멘트 + warnings 메시지
  - `backend-py/auth.py` proxy 정책 + TEST_ADMIN_* 회수 절차 코멘트
  - `backend-py/migrations.py` 운영 DB 시나리오 코멘트
  - `backend-py/routes_crud.py` rate-limiter 코멘트
  - `backend-py/routes_geo.py` 캐시 코멘트
  - `backend-py/routes_short_links.py` 모듈 docstring
  - `src/lib/keepAlive.js` 모듈 docstring
  - `src/lib/api.js` / `src/lib/auth.js` / `src/admin/AdminGate.jsx` 코멘트
  - `src/admin/InquiriesGuide.jsx` / `UtmBuilderGuide.jsx` / `AdminMainGuide.jsx`
    의 사용자 노출 가이드 텍스트
  - `src/admin/AdminInquiries.jsx` 의 fallback 안내 메시지
- 실제 코드/로직 변경 없음 — 코멘트와 사용자 표시 텍스트만. 호스팅 제공자
  변경 시 메시지가 자연스럽게 통하도록 generic 하게 표현.

### 2차 (2026-05-01)
- `backend-py/auth.py` — login throttle lock 도달 시 `suspicious.record_async("brute_force_login", "high")` 자동 호출 (F-7).
- `backend-py/suspicious.py` — `record_async()` 신규 (AsyncSession 호환).
- `backend-py/main.py` — `_retention_cron` 에 `SuspiciousEvent` sweep 추가 (90일 / evidence 365일) (F-8).
- `backend-py/routes_crud.py` — 자동회신 메일이 `send_email` 유니파이드 라우팅 통과 → Resend 미설정 시 SMTP fallback 자동.
- `backend-py/main.py` — lifespan fail-soft (DB 죽어도 startup 진행) + login endpoint 의 8s DB ping (cold-start 호환).
- `backend-py/auth.py` — login error message 한국어화 + login.failure 의 정확한 reason logs.
- `src/lib/api.js` — fetch 에러를 친근한 한국어 메시지로 변환 (`TypeError: Failed to fetch` → "서버에 연결할 수 없습니다").
- `src/lib/globals.js` — **`window.api` 노출** (모든 RawPage hydrate 가 silent fail 이던 critical bug fix).

운영 코드 미수정 항목 (사용자 결정 필요):
- F-2 JWT_SECRET fail-closed (현재 ephemeral fallback)
- F-4 ENV=prod 강제 + 시드 비밀번호 교체 운영 절차
- F-5 DAEMU_RESET_TOTP_EMAIL 1회 사용 후 자동 disarm
- F-6 MYSQL_SSL_CA 미설정 + ENV=prod 시 fail-closed
