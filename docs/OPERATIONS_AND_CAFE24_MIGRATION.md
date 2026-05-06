# 운영 / Cafe24 이전 가이드

> 본 문서는 운영자 / 인수자(後 Cafe24) 가 본 사이트를 안전하게 운영·이전하기 위한
> 절차서입니다. 비밀번호 / API 키 / DB URL 등 **시크릿 값은 일체 포함되어
> 있지 않습니다** — 변수 이름과 그 역할만 명시합니다. 실제 값은 운영자
> 본인의 비밀 저장소(Bitwarden / 1Password / 환경 변수)에서 관리하세요.

## 1. 현재 아키텍처

```
┌────────────────────────────────────────────────┐
│  사용자 브라우저 (PC / 모바일)                 │
└──────────────┬─────────────────────────────────┘
               │ HTTPS
               ▼
┌────────────────────────────────────────────────┐
│  GitHub Pages — React/Vite 정적 산출물         │
│  https://juyoungjun.github.io/daemu-website/    │
│   · src/main.jsx → src/App.jsx → /admin/*       │
│   · public/admin-*-page.js (RawPage hydrate)    │
└──────────────┬─────────────────────────────────┘
               │ fetch  (VITE_API_BASE_URL)
               ▼
┌────────────────────────────────────────────────┐
│  Render — FastAPI backend (backend-py/*)        │
│  https://daemu-py.onrender.com                  │
│   · /api/auth/*  (admin JWT)                    │
│   · /api/partner-auth/*  (partner JWT)          │
│   · /api/inquiries / works / partners / orders  │
│     /popups / promotions / crm / campaigns /    │
│     announcements / partner-brands / users /    │
│     inventory / products / mail-template /      │
│     content / media / outbox / short-links 등   │
└──────────────┬─────────────────────────────────┘
               │ TLS  (MYSQL_SSL_CA)
               ▼
┌────────────────────────────────────────────────┐
│  Aiven MySQL — service / admin 데이터의 source │
│  of truth                                      │
└────────────────────────────────────────────────┘

부가:
  · 메일 발송: SendGrid Web API (HTTPS)
  · 파일 업로드: Render disk (휘발성) — 운영 전 외부 storage(S3/R2) 이전
  · 분석: Aiven `analytics` 집계 + 브라우저 자체 추적(localStorage)
```

## 2. Source of truth 정책

| 데이터 / 상태 | 저장 위치 | 비고 |
|---|---|---|
| 어드민 / 서비스 / 파트너 데이터 (works / orders / partners / users / promotions / popups / inquiries / crm / campaigns / announcements / partner-brands / products / inventory / contracts / documents / media / mail templates / outbox / short-links) | **Aiven MySQL** | 모든 어드민 RawPage 가 `daemuHydrate` 로 backend 응답을 in-memory store 에 적재. 같은 계정이 어떤 환경에 로그인해도 동일 데이터 |
| 어드민 JWT (`daemu_admin_token`) | localStorage | 만료 시 재로그인 |
| 파트너 JWT (`daemu_partner_token`) | localStorage | partner-scoped 인증 |
| UI 임시 상태 (검색어 / 모달 / 작성 중 임시본) | localStorage 또는 sessionStorage | 명확히 "임시 / 미저장 draft" 로 표시 |
| 마케팅 분석 (`daemu_marketing_*`) | localStorage | 브라우저 자체 추적 (PIPA 동의 후) |
| **금지** | localStorage | 서비스 / 어드민 공유 데이터의 source of truth |
| 로컬 dev / 테스트 임시 DB | SQLite (`daemu.db`) | `ENV != prod` 일 때만. 운영 부팅 시 `RuntimeError` 로 차단 |

## 3. 환경 변수 (이름만, 값 X)

backend (Render `daemu-py` 서비스 또는 Cafe24 systemd EnvironmentFile):

| 변수 | 역할 |
|---|---|
| `ENV` | `prod` 시 fail-closed (필수 secret 미설정 시 부팅 거부) |
| `DATABASE_URL` | `mysql+aiomysql://USER:PW@HOST:3306/DB` 형식. URL 인코딩 자동 처리 |
| `MYSQL_SSL_CA` | Aiven 발급 CA PEM 본문(전체 `-----BEGIN CERTIFICATE----- … -----END`). 미설정 시 SSL verify 우회 + 경고. 운영 단계 필수 |
| `MYSQL_DRIVER` | (선택) `aiomysql` 기본, `asyncmy` 가능 |
| `JWT_SECRET` | 32+ 문자 임의 16진수 (Render `generateValue: true` 자동) |
| `JWT_TTL_HOURS` | 기본 12시간 |
| `ADMIN_EMAIL` | 첫 부팅 시 시드될 어드민 이메일 (기본 `admin@daemu.kr`) |
| `ADMIN_PASSWORD` | (선택) 강한 비밀번호. 미설정 시 admin 자동 시드 안 함 |
| `TESTER_EMAIL`, `TESTER_PASSWORD` | (선택) tester 역할 시드 |
| `DEVELOPER_EMAIL`, `DEVELOPER_PASSWORD` | (선택) developer 역할 시드 |
| `ALLOWED_ORIGINS` | CORS allowlist. 운영: `https://juyoungjun.github.io` 또는 정식 도메인 |
| `TRUST_FORWARDED_FOR` | Render / Cafe24 nginx 등 reverse proxy 뒤에서 `X-Forwarded-For` 신뢰 |
| `RESEND_API_KEY` | (옵션) Resend SMTP-over-HTTPS |
| `SENDGRID_API_KEY` | SendGrid Web API 키 (현재 운영 기본) |
| `SENDGRID_FROM` 또는 `FROM_EMAIL` | 발신 이메일 주소 (예: `DAEMU <noreply@yourdomain.com>`) |
| `SENDGRID_FROM_NAME` | (옵션) 발신 표시 이름 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | (옵션) SMTP fallback |
| `EMAIL_PROVIDER` | `auto` / `sendgrid` / `smtp` / `resend` 중 강제 선택 (옵션) |
| `PUBLIC_BASE_URL` | `/uploads/...` 절대 URL prefix (외부 storage 또는 자기 도메인) |
| `PYTHON_VERSION` | (Render) `3.12.7` 등 |

frontend (GitHub Actions Variables 또는 빌드 환경):

| 변수 | 역할 |
|---|---|
| `VITE_API_BASE_URL` | backend URL (예: `https://daemu-py.onrender.com` 또는 `https://api.daemu.kr`) |
| `GH_PAGES` | `1` 일 때 vite `base = '/daemu-website/'` 적용 |
| `VITE_SITE_BASE_URL` | (옵션) canonical / og:url. 운영 도메인 |
| `VITE_PLAUSIBLE_DOMAIN` | (옵션) Plausible 도메인 |
| `VITE_GA4_ID` | (옵션) GA4 Measurement ID (사용자 동의 후 로드) |

## 4. Cafe24 이전 단계

가정: Aiven MySQL 은 그대로 두고 backend 만 Cafe24 호스팅으로 이전 (DB 까지 함께 이전 시 §5 참조).

1. **Cafe24 호스팅 계약** — Python 가상호스팅 / 가상서버 (sudo 가능 권장).
2. **시스템 패키지 설치**:
   ```
   sudo apt update
   sudo apt install -y python3.12 python3.12-venv build-essential nginx certbot python3-certbot-nginx
   ```
3. **소스 배포**:
   ```
   sudo mkdir -p /srv/daemu
   sudo chown $USER:$USER /srv/daemu
   git clone https://github.com/JuYoungJun/daemu-website.git /srv/daemu
   cd /srv/daemu/backend-py
   python3.12 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```
4. **환경 변수** — `/etc/daemu.env` 생성 (root 만 read):
   ```
   ENV=prod
   DATABASE_URL=mysql+aiomysql://...
   MYSQL_SSL_CA="-----BEGIN CERTIFICATE-----
   ...
   -----END CERTIFICATE-----"
   JWT_SECRET=...
   ALLOWED_ORIGINS=https://daemu.kr,https://www.daemu.kr
   PUBLIC_BASE_URL=https://api.daemu.kr
   SENDGRID_API_KEY=...
   FROM_EMAIL=DAEMU <noreply@daemu.kr>
   ```
   퍼미션:
   ```
   sudo chmod 600 /etc/daemu.env
   ```
5. **systemd unit** — `/etc/systemd/system/daemu-backend.service`:
   ```ini
   [Unit]
   Description=DAEMU FastAPI backend
   After=network.target

   [Service]
   User=daemu
   Group=daemu
   WorkingDirectory=/srv/daemu/backend-py
   EnvironmentFile=/etc/daemu.env
   ExecStart=/srv/daemu/backend-py/.venv/bin/gunicorn main:app -k uvicorn.workers.UvicornWorker -w 2 -b 127.0.0.1:8000 --timeout 60
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now daemu-backend
   ```
6. **nginx reverse proxy + HTTPS**:
   ```nginx
   server {
       listen 443 ssl http2;
       server_name api.daemu.kr;

       ssl_certificate     /etc/letsencrypt/live/api.daemu.kr/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/api.daemu.kr/privkey.pem;

       location / {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
       location /uploads/ {
           proxy_pass http://127.0.0.1:8000/uploads/;
       }
   }
   ```
   ```
   sudo certbot --nginx -d api.daemu.kr
   ```
7. **CORS 갱신** — `ALLOWED_ORIGINS` 에 정식 도메인 (`https://daemu.kr`) 추가, 옛 GitHub Pages 도메인 제거.
8. **frontend 재빌드**:
   ```
   # GitHub Actions Variables 에서 VITE_API_BASE_URL=https://api.daemu.kr 로 갱신
   # 또는 로컬 빌드:
   VITE_API_BASE_URL=https://api.daemu.kr GH_PAGES=1 npm run build
   ```
   GitHub Pages 자동 deploy 또는 자체 호스팅 (nginx 정적 서빙) 으로 배포.
9. **파일 storage** — Render disk 의 `/uploads/` 데이터를 외부 storage 로 이전:
   - S3 / R2 / Backblaze B2 등에 SDK or rclone 으로 sync
   - `PUBLIC_BASE_URL` 을 storage CDN URL 로 갱신
10. **메일 도메인 인증** — `daemu.kr` 의 DNS 에:
    - SPF: `TXT @ "v=spf1 include:sendgrid.net -all"`
    - DKIM: SendGrid 콘솔의 Domain Authentication 후 발급된 CNAME 3건
    - DMARC: `TXT _dmarc "v=DMARC1; p=quarantine; rua=mailto:postmaster@daemu.kr"`
11. **smoke test**:
    ```
    curl -sI https://api.daemu.kr/api/health
    curl https://daemu.kr/admin           # GitHub Pages → 404 fallback → SPA
    ```

## 5. MySQL backup / restore

Aiven 또는 Cafe24 self-host 모두 동일 (MySQL standard).

backup (정기적으로 cron 권장):
```
mysqldump \
  --host=$MYSQL_HOST --port=$MYSQL_PORT --user=$MYSQL_USER \
  --password=<별도 안전 입력> --ssl-mode=REQUIRED \
  --single-transaction --quick --routines --triggers --events \
  $MYSQL_DB | gzip > /var/backups/daemu_$(date +%Y%m%d_%H%M%S).sql.gz
```

restore (마이그레이션 / 롤백 시):
```
gunzip -c daemu_YYYYMMDD_HHMMSS.sql.gz | mysql \
  --host=$MYSQL_HOST --port=$MYSQL_PORT --user=$MYSQL_USER \
  --password=<별도 안전 입력> --ssl-mode=REQUIRED \
  $MYSQL_DB
```

> 본 명령에 실제 비밀번호를 직접 넣지 말고 `~/.my.cnf` 의 `[client]` 섹션 또는 `MYSQL_PWD` 환경변수 사용. 명령 history / process list 에 비밀번호 노출 회피.

## 6. 배포 체크리스트

- [ ] `ENV=prod` 설정
- [ ] `DATABASE_URL` 설정 + Aiven 또는 Cafe24 MySQL 응답 확인
- [ ] `MYSQL_SSL_CA` 등록 (verify-required)
- [ ] `JWT_SECRET` 32+ 문자 임의 값
- [ ] `ALLOWED_ORIGINS` 운영 도메인만
- [ ] `SENDGRID_API_KEY` 또는 SMTP 설정
- [ ] `FROM_EMAIL` / `SENDGRID_FROM` 정식 도메인
- [ ] `PUBLIC_BASE_URL` 외부 storage URL
- [ ] backend `/api/health` 200 OK
- [ ] backend `/api/auth/login` 정상 (admin 계정)
- [ ] backend `/api/partner-auth/login` 정상 (partner 계정)
- [ ] frontend `VITE_API_BASE_URL` 갱신 + 재빌드
- [ ] CORS preflight 정상 (`OPTIONS` 200)
- [ ] 메일 도메인 SPF/DKIM/DMARC verified
- [ ] HTTPS 인증서 (Let's Encrypt 자동 갱신)
- [ ] 정기 backup cron 등록
- [ ] 모니터링 / 로그 aggregator 연결

## 7. 롤백 체크리스트

- [ ] 직전 commit 식별 (`git log -10 --oneline`)
- [ ] Render: 직전 deploy 의 commit 으로 manual deploy
- [ ] Cafe24: `cd /srv/daemu && git checkout <hash> && systemctl restart daemu-backend`
- [ ] DB 변경 동반 시: 직전 backup 으로 restore (§5)
- [ ] frontend: GitHub Pages Actions 의 직전 successful run 의 artifact 로 재배포
- [ ] 사용자 검증: 로그인 / 한 페이지 데이터 표시 / CSV 다운로드 정상

## 8. 보안 체크리스트

- [ ] 모든 secret rotate (배포 직후 + 분기마다)
- [ ] 어드민 계정 2FA (TOTP) + 복구 코드 별도 안전 보관
- [ ] default password 0개 — `daemu1234` / `tester1234` / `dev1234` 등 prod 사용 금지 (auth.py fail-closed 검증)
- [ ] `ALLOWED_ORIGINS` 에 `localhost` 항목 0개 (prod)
- [ ] `MYSQL_SSL_CA` 등록 → `verify-required` 모드
- [ ] HTTPS only (HTTP → HTTPS redirect)
- [ ] DB backup 암호화 + offsite 보관
- [ ] 메일 도메인 인증 (SPF / DKIM / DMARC)
- [ ] `/openapi.json` 운영 비공개 (`openapi_url=None if PROD`) — 변경 X
- [ ] X-Forwarded-For 신뢰 정책 (`TRUST_FORWARDED_FOR=1`) reverse proxy 뒤에서만
- [ ] audit_logs 정기 검토 (관리 행동 추적)
- [ ] suspicious_events 알림 (brute force / abuse 탐지)

## 9. 데모 데이터 setup

운영 시점에는 backend API 만으로 데모 데이터를 추가합니다 (localStorage seed 일체 사용 금지).

### 9.1 admin 계정 추가
```
# 운영자 본인이 admin@daemu.kr 로 로그인 후 /admin/users 에서 추가.
# 또는 Cafe24 shell 에서 backend-py/manage.py 로 직접:
cd /srv/daemu/backend-py
.venv/bin/python -m manage list-admins
.venv/bin/python -m manage promote-to-admin --email new@daemu.kr --role admin
```

### 9.2 demo data 멱등 import 스크립트 (운영자 토큰 필요)

```bash
# /tmp/daemu-qa/seed-demo-data.mjs (예시 — 별도 안전 채널에서 실제 스크립트 받음)
# 사용법:
#   export DAEMU_API_BASE=https://daemu-py.onrender.com
#   export DAEMU_ADMIN_TOKEN=<운영자 로그인 후 받은 JWT>
#   node /tmp/daemu-qa/seed-demo-data.mjs
#
# 동작:
#   · GET /api/works 로 기존 행 조회 → slug 중복 시 skip
#   · POST /api/works {slug, title, ...} 로 신규 행 추가
#   · 동일 패턴으로 popups / promotions / announcements / partner-brands
#   · 모든 mutation 후 GET 재호출로 검증
#   · 기존 데이터 삭제 / 갱신 X
```

> 비밀번호 / 토큰은 환경 변수로만 전달. 스크립트는 stdout / log 에 token 출력 X.

## 10. 알려진 제한사항

- **Render Free 디스크 휘발성** — `/uploads/` 재배포 시 소실. 운영 단계에서 외부 storage 이전 필수.
- **Render Free cold start** — 15분 idle 후 30~60초 응답 지연. Render 유료 / Cafe24 self-host 로 해소.
- **메일 도메인 미인증 단계** — 발송 메일이 스팸함 분류. SPF/DKIM/DMARC 후 해소.
- **`/admin/products` 페이지** — `/admin/inventory` 로 redirect (Aiven `products` 테이블 일원화).
- **`/admin/media` 미디어 메타** — backend `/api/media` 라우트 + `media_assets` 테이블 도입 (2026-05). frontend `MediaPicker.jsx` 의 backend 통합은 운영 단계 직전에 마무리 예정.
- **partner auth** — backend `/api/partner-auth/*` 도입(2026-05). 기존 `partners` 테이블 행에 `password_hash` 컬럼 추가됨. 운영 시작 전 운영자가 어드민 `/admin/users` 또는 backend CLI 로 `testpartner@daemu.kr` 의 비밀번호 시드 필요.
- **`/admin/mail-templates` 일괄 발송** — 백엔드 라우트 미존재. 운영 단계 전 발송 도메인 인증과 함께 정리.
- **localStorage 잔재** — 옛 admin RawPage 의 `daemu_<storageKey>` localStorage 키들이 사용자 브라우저에 남아 있을 수 있음. 새 아키텍처에서는 읽지 않으므로 무해. 사용자가 cache clear 하면 정리됨.

---

본 문서는 운영자 인수인계 + Cafe24 이전 시점에 그대로 활용할 수 있도록 작성되었습니다. 실제 secret 은 별도 안전 저장소에서 관리하세요.
