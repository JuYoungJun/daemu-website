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

> **현재 Render/Aiven 데모는 `.env` 파일이 필요 없습니다.**
> backend env 는 모두 **Render Dashboard → Environment Variables** 에서
> 관리하고, GitHub Pages frontend 는 build-time variable (GitHub Actions
> Variables) 만 사용합니다. 로컬 개발 (`ENV=dev`) 시에만 선택적으로
> `backend-py/.env` 를 두면 `load_dotenv()` 가 자동 merge 합니다 — 운영에
> 영향 없음. `deploy/cafe24/.env.example` 은 **추후 Cafe24 이전 시점의
> systemd EnvironmentFile 템플릿**으로만 사용됩니다 (실제 `.env` 파일
> 자체는 git 에 커밋하지 않으며 Cafe24 서버에서만 작성).

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

## 11. 기존 데이터 (Existing Data) Aiven 이관

데모 단계에서 옛 admin RawPage 가 localStorage 에 행을 쌓던 시기의 데이터가 사용자 PC 브라우저에 남아 있을 수 있습니다. backend = source of truth 로 전환된 이후 그 데이터를 Aiven 에 가져오려면 다음 절차를 따르세요.

### 11.1 사전 점검

1. **Aiven 현재 행 수 audit** (DB write 전 baseline 파악):
   ```
   export DAEMU_API_BASE=https://daemu-py.onrender.com
   export DAEMU_ADMIN_EMAIL=admin@daemu.kr
   export DAEMU_ADMIN_PASSWORD=...   # 별도 안전 채널
   node /tmp/daemu-qa/audit-aiven-data.mjs
   ```
   `/api/admin/stats` 가 반환하는 counts 가 import 전 baseline.

2. **MySQL 백업** (`§5` 참고) — import 전에 dump 1회. 잘못되면 복원 가능.

### 11.2 옛 brower localStorage export

옛 데이터가 남아 있는 브라우저 (예: 데모 시연하던 PC 의 같은 브라우저 프로필) 에서:

1. 운영자가 `/tmp/daemu-qa/export-localstorage.html` 을 그 PC 로 전송 (USB / 메신저 첨부 / 동기화 폴더).
2. 해당 PC 에서 본 HTML 파일을 더블클릭 → 브라우저로 열림.
3. 단, **localStorage 는 origin 단위** 라 `file://` 로 연 페이지는 GitHub Pages 의 `https://juyoungjun.github.io` localStorage 를 못 봄. 따라서:
   - 옛 데이터가 있는 PC 에서 `https://juyoungjun.github.io/daemu-website/` 를 열고
   - DevTools (F12) → Console 탭 열고
   - 본 export HTML 의 `<script>` 블록만 복사해서 Console 에 붙여넣고 실행
   - 또는 Console 에 직접 한 줄로:
     ```js
     (() => { const KEYS = ['daemu_works','daemu_inquiries','daemu_partners','daemu_orders','daemu_popups','daemu_promotions','daemu_coupons','daemu_campaigns','daemu_crm','daemu_subscribers','daemu_media','daemu_projects','daemu_products','daemu_partner_brands','daemu_siteinfo']; const out = { exportedAt: new Date().toISOString(), schema: 'daemu-localstorage-v1', data: {} }; for (const k of KEYS) { const v = localStorage.getItem(k); if (v != null) { try { out.data[k] = JSON.parse(v); } catch { out.data[k] = v; } } } const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })); a.download = 'daemu-export-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '.json'; a.click(); console.log('export rows:', Object.fromEntries(Object.entries(out.data).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1]))); })();
     ```
4. 다운로드된 `daemu-export-YYYYMMDD.json` 파일을 운영자 본인 PC 로 안전 채널 (Bitwarden Send / 메신저 / 동기화 폴더) 로 가져옴.

본 export 는 **auth 토큰 / 비밀번호 / 쿠키 / 세션 마커를 절대 포함하지 않습니다** — 알려진 서비스 데이터 키 (`daemu_works`, `daemu_inquiries`, `daemu_partners`, `daemu_orders`, `daemu_popups`, `daemu_promotions`, `daemu_coupons`, `daemu_campaigns`, `daemu_crm`, `daemu_subscribers`, `daemu_media`, `daemu_projects`, `daemu_products`, `daemu_partner_brands`, `daemu_siteinfo`) 만 추출.

### 11.3 멱등 import

```
node /tmp/daemu-qa/import-local-data-to-aiven.mjs ~/Downloads/daemu-export-YYYYMMDD.json
```

스크립트 동작:
- admin 로그인 → JWT 획득.
- 각 데이터셋 (works/popups/promotions/partners/crm/subscribers/media) 별로:
  1. `GET /api/<resource>?page_size=500` 으로 기존 행 조회.
  2. dedup 키 (slug / title / code / email / url) 가 일치하는 행 있으면 **skip**.
  3. 없으면 `POST /api/<resource>` 로 신규 행 추가.
- delete / overwrite / update 일체 없음.
- 완료 후 `GET /api/admin/stats` 로 새 counts 출력.

### 11.4 멱등 키 / 매핑

| Dataset | localStorage key | backend endpoint | dedup key |
|---|---|---|---|
| works (admin shape) | `daemu_works`, `daemu_projects` | `POST /api/works` | `slug` |
| popups | `daemu_popups` | `POST /api/popups` | `title` |
| promotions / coupons | `daemu_promotions`, `daemu_coupons` | `POST /api/promotions` | `code` |
| partners | `daemu_partners` | `POST /api/partners` | `email` |
| crm | `daemu_crm` | `POST /api/crm` | `email` |
| newsletter subscribers | `daemu_subscribers` | `POST /api/newsletter` | `email` |
| media | `daemu_media` | `POST /api/media` | `url` |

### 11.5 미디어 메타데이터 복구 한계

옛 미디어 메타 (`daemu_media`) 의 `src` 가 다음 형태일 수 있음:

- `data:image/...;base64,...` → 브라우저 메모리 인라인. **Aiven 으로 가져갈 수 없음** (실제 파일이 외부에 없음). 옛 화면에서는 보였지만, 서버가 해당 base64 를 file 로 가지고 있지 않은 한 다른 PC 에서는 보이지 않음. 운영 단계 전 외부 storage (S3/R2/Cafe24) 로 재업로드 필요.
- `https://juyoungjun.github.io/daemu-website/assets/...` → GitHub Pages 정적 자산. 그대로 import 가능.
- `https://daemu-py.onrender.com/uploads/...` → Render disk 휘발성. 재배포 후 사라졌으면 import 해도 broken link.
- `data:video/...` → 동일하게 인라인. 외부 storage 이전 후 URL 갱신 필요.

import 스크립트는 url 그대로 저장만 하며, 깨진 링크 복구는 하지 않음. 운영 단계에서 외부 storage 로 일괄 업로드 후 `media_assets.url` 을 재매핑 권장.

### 11.6 가져갈 수 없는 데이터

- **인증 / 세션 마커** (`daemu_admin_token`, `daemu_partner_token`) — 의도적 제외. 로그인은 backend 에서 발급.
- **사용자 화면 dismiss UX 상태** (`daemu_popup_dismissed_*`) — 사용자별 / 브라우저별 임시 상태.
- **dev/demo 시드 partner 로그인** (`daemu_partner_logins`) — backend partner-auth 시드 (`/tmp/daemu-qa/seed-test-partner.mjs`) 로 별도 처리.
- **배포 캐시** — 옛 chunk hash 등 운영 데이터 아님.
- 옛 admin 페이지의 **`daemu_*` localStorage 가 비어 있는 브라우저** — export 결과가 빈 객체. 이 경우 사용자가 이전에 시연한 적 없는 PC.

### 11.7 import 후 검증

```
node /tmp/daemu-qa/audit-aiven-data.mjs
```

import 전 / 후 counts 비교 → 추가된 행 수 확인. 어드민 UI 에서 / 다른 브라우저로 같은 계정 로그인해서 동일하게 보이면 정상.

### 11.8 추가 demo data seed (옛 데이터 부족 시)

```
node /tmp/daemu-qa/seed-demo-data.mjs
```

works 6 / popup 1 / promotion 1 / announcement 1 멱등 추가 (slug/title/code/title 중복 시 skip).

### 11.9 testpartner 비밀번호 시드

```
export DAEMU_TEST_PARTNER_PASSWORD=<운영자 결정 8자+>
node /tmp/daemu-qa/seed-test-partner.mjs
```

`POST /api/partners/{id}/set-password` (admin → partner 비밀번호 시드 endpoint) 호출 → backend 가 passlib bcrypt 로 hash 후 저장.

## 12. 메일 도달성 (DMARC / SendGrid Domain Authentication)

### 12.1 왜 필요한가
백엔드는 SendGrid Web API 로 메일을 발송한다 (`backend-py/main.py` `send_via_sendgrid`).
SendGrid 가 자동으로 붙이는 DKIM 서명 도메인은 기본 `d=sendgrid.net`. 만약 `SENDGRID_FROM` 을
`xxx@gmail.com` 같은 public mailbox 도메인으로 두면:

- header `From:` 도메인 = `gmail.com`
- DKIM `d=` = `sendgrid.net`
- → 두 도메인이 일치하지 않으므로 **DMARC alignment 실패** → Gmail / Naver 등이 “스팸” 또는
  “도용 발송 의심” 으로 자동 분류 (사용자가 받은 raw 헤더에서 `dmarc=fail` 로 확인됨).

해결 = SendGrid Domain Authentication 으로 자체 도메인 (예: `mail.daemu.kr`) 의 DKIM/SPF
DNS 레코드를 셋업한 뒤 `SENDGRID_FROM` 을 그 도메인 메일박스로 바꾸는 것.

### 12.2 백엔드의 가드 (자동)
`backend-py/main.py` 가 SendGrid 호출 전에 `SENDGRID_FROM` 도메인을 검사:

- gmail.com / naver.com / daum.net / hanmail.net / kakao.com / nate.com / outlook.com /
  hotmail.com / yahoo.com / icloud.com 등 public mailbox 도메인이면:
  - `ENV=prod` → 발송 차단 (`{"ok": false, "error": "SendGrid sender domain blocked: ..."}`).
  - `ENV` 가 prod 가 아니면 startup 후 첫 발송 시 stderr 경고 한 줄.
- 자체 도메인 (예: `daemu.kr`, `mail.daemu.kr`) 이면 통과.

→ 운영자가 실수로 gmail 주소를 set 해도 PROD 에서는 자동 거부되므로 spam 폭주 위험을 막는다.

### 12.3 SendGrid Domain Authentication 절차
SendGrid 대시보드 (`https://app.sendgrid.com`) 로그인 후:

1. `Settings → Sender Authentication → Domain Authentication → Authenticate Your Domain`.
2. DNS host 선택 (가비아 / Cloudflare / Cafe24 DNS 등).
3. `Use a custom return path?` Yes 권장 — alignment 가 가장 깔끔.
4. Domain 입력: `daemu.kr` (또는 mail subdomain 으로 격리하고 싶으면 `mail.daemu.kr`).
5. 다음 페이지에서 SendGrid 가 CNAME 3개를 보여줌:
   ```
   em####.daemu.kr             CNAME → uXXXXXXX.wlYYY.sendgrid.net
   sYYY._domainkey.daemu.kr    CNAME → sYYY.domainkey.uXXXXXXX.wlYYY.sendgrid.net
   sZZZ._domainkey.daemu.kr    CNAME → sZZZ.domainkey.uXXXXXXX.wlYYY.sendgrid.net
   ```
6. 운영 도메인 DNS 콘솔에서 위 CNAME 3개 추가 (TTL 600 권장 — 빠른 검증).
7. SendGrid 페이지로 돌아와 `Verify` 클릭 — 5–30 분 후 PASS 표시.

검증 후 같은 화면에 “Link Branding”, “DKIM” 항목이 모두 ✅ 로 바뀌는지 확인.

### 12.4 SPF / DMARC 추가 DNS 레코드
Domain Authentication 으로 DKIM 은 끝났지만 SPF / DMARC 도 같이 셋업하는 것이 권장:

```
# SPF (TXT, host = @ 또는 daemu.kr)
v=spf1 include:sendgrid.net ~all

# DMARC (TXT, host = _dmarc.daemu.kr)
v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@daemu.kr; adkim=s; aspf=s
```

처음에는 `p=none` 으로 두고 일주일간 SendGrid 통계 + DMARC 리포트 확인 후 `quarantine`,
충분히 안정되면 `reject` 로 단계적으로 강화.

### 12.5 Render / Cafe24 환경 변수 갱신
DNS PASS 확인 후:

```
SENDGRID_FROM=hello@mail.daemu.kr        # 또는 noreply@daemu.kr
SENDGRID_FROM_NAME=DAEMU
SENDGRID_API_KEY=SG.xxxxxx               # 그대로
EMAIL_PROVIDER=sendgrid                  # 강제 sendgrid (auto 도 OK)
ENV=prod                                 # 가드가 발동되도록
```

저장 → 서비스 재시작 → /admin/mail 에서 테스트 발송.

### 12.6 Gmail 에서 DMARC PASS 확인
1. 자기 gmail 로 테스트 메일 발송.
2. Gmail 우측 상단 ⋮ → `메일 원본 보기 (Show original)`.
3. 헤더 상단 박스에서 다음을 확인:
   - `SPF: PASS with IP …`
   - `DKIM: 'PASS' with domain mail.daemu.kr` (또는 daemu.kr)
   - `DMARC: 'PASS'`
4. DKIM domain 이 `sendgrid.net` 이 아니라 자체 도메인이면 alignment 성공.

### 12.7 본문 inline-image 자리표시자 (`[[img:cid:...]]`) 정리
어드민 메일 편집기는 inline 이미지를 HTML 본문에는 `<img>` 로, plain text 본문에는
`[[img:cid:abc123]]` 같은 자리표시자로 남긴다. SendGrid / Resend / SMTP 모두 plain 본문을
그대로 받기 때문에 수신자에게 마커가 노출되는 이슈가 있었음.

→ `send_email()` dispatcher 가 모든 provider 호출 직전에 `[[img:cid:…]]` 패턴을 정규식으로
제거. 운영자가 별도 처리할 필요 없음. 향후 새 marker 패턴이 생기면 `_CID_PLACEHOLDER_RE`
업데이트 필요.

### 12.8 `{{변수}}` 가 본문에 그대로 보이는 경우
드물게 자동회신 본문에 `{{message}}` 같은 placeholder 가 그대로 보였다는 보고는 보통
**테스트용 메시지 본문 자체가 `{{message}}` 라는 문자열을 포함**한 케이스 (admin/mail 페이지의
TEST 송신 payload 가 그렇게 작성돼 있음). 실제 자동회신은
`backend-py/routes_crud.py::_apply_vars()` 가 `\{\{\s*([\w-]+)\s*\}\}` regex 로 치환.

확인 절차:
1. /admin/mail 의 “자동회신 템플릿” 본문에 `{{name}}`, `{{category}}`, `{{message}}` 가
   placeholder 로 들어 있는지 확인 — 정상.
2. 테스트 발송 시 실제 입력된 `message` 필드 값이 텍스트 그대로 송신됨 (이중 치환 X).

## 13. Render + Aiven 진단 워크플로

> 본 절은 **현재 Render/Aiven 데모를 운영하면서 backend logs / DB schema** 를 직접
> 확인할 때 사용하는 진단 절차입니다. 진단은 **읽기 전용**이 원칙이고, 직접 DB
> write / DDL 수정은 별도 명시 승인 후에만 진행합니다.

### 13.1 Render CLI

설치 (macOS Apple Silicon 기준):

```
brew tap render-oss/render
brew install render
render --version          # ex) render v2.16.0
```

로그인 (브라우저 OAuth):

```
render login
# default 브라우저가 열림 → GitHub / Google 로 로그인 → CLI 가 token 저장.
# token 은 ~/.render/config.* 에 저장됨 — git 에 절대 커밋 X.
render whoami
```

자주 쓰는 명령:

```
render workspace list                 # workspace 식별
render workspace set <workspace-id>   # 작업 workspace 고정 (선택)
render services                       # service 목록
render services list --output json    # service ID 포함 (daemu-py 의 srv-... 식별)
render deploys list <service-id>      # 최근 deploy 이력
render deploys get <deploy-id>        # 특정 deploy 상태
render logs <service-id> --tail       # 라이브 로그 tail (Ctrl-C 종료)
render logs <service-id> --start 5m   # 최근 5분 logs
render logs <service-id> --text "request_id=05462feae3ae"   # 특정 request_id 검색
```

수동 배포 (commit hash 지정 가능 — 명시 승인 후만):

```
render deploys create <service-id>            # latest commit re-deploy
render deploys create <service-id> --commit <sha>
```

### 13.2 request_id traceback 워크플로

backend `main.py` 의 `attach_request_id` middleware 가 모든 응답에
`X-Request-ID` 를 부착하고 unhandled exception 시점에 logs 에 같은 ID 로 traceback
을 적재합니다. 클라이언트가 받은 `{"ok":false,"error":"internal","request_id":"<rid>"}` 를
그대로 logs 검색에 넣으면 정확한 stack trace 1건이 나옵니다.

```
render logs <service-id> --text "rid=<request_id>" --start 10m
```

### 13.3 Aiven CLI

설치 (Python 패키지, macOS Apple Silicon 에서 PEP 668 우회):

```
brew install pipx           # 한 번만
pipx ensurepath
pipx install aiven-client
avn --version              # ex) aiven-client 4.13.0
```

로그인 (이메일/비밀번호 또는 토큰):

```
avn user login <my-aiven-email>     # password prompt
# 또는
avn user create-token --description "daemu diagnostics"
avn user logout                     # 진단 끝나면 logout 권장
```

자주 쓰는 read-only 명령 (목록 / 상태 / 백업):

```
avn project list
avn service list --project <project-name>
avn service get --project <project> <mysql-service>
avn service backup-list --project <project> <mysql-service>
avn service current-queries --project <project> <mysql-service>
avn service connection-info --project <project> <mysql-service>
# connection-info 는 비밀번호를 출력 — `--json | jq '.[]|del(.password)'` 같은 식
# 으로 redact 후 공유.
```

### 13.4 read-only MySQL 진단 SQL

Aiven console 의 SQL workbench 또는 Render backend 의 `/api/admin/__schema_diag`
같은 임시 endpoint 안에서 사용. **`SHOW TABLES`, `information_schema.*` 외 destructive
SQL (DROP/DELETE/TRUNCATE/ALTER/UPDATE/INSERT/CREATE INDEX) 은 명시 승인 후에만.**

```
SHOW TABLES;

SELECT table_name, table_rows
  FROM information_schema.tables
 WHERE table_schema = DATABASE()
 ORDER BY table_name;

SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = DATABASE()
 ORDER BY table_name, ordinal_position;

SELECT table_name, index_name, column_name, non_unique
  FROM information_schema.statistics
 WHERE table_schema = DATABASE()
 ORDER BY table_name, index_name, seq_in_index;
```

### 13.5 보안 / 운영 가드

- **token / password / API key 절대 git 커밋 X**. `~/.render/`, `~/.config/aiven/`,
  `~/.avn/` 같은 CLI config 도 커밋 금지 (이미 `.gitignore` 의 `.env` 패턴과 함께
  보호되지만 신규 파일이 생기면 직접 확인).
- 진단 logs 에 password / DB URL credentials 가 보이면 stdout 에 다시 출력하지
  말고 `| sed`/`| jq del()` 로 마스킹 후 공유.
- 직접 DB write / DDL 변경은 운영자 +1 명의 명시 승인 + 작업 직전 `avn service
  backup-list` 로 백업 시점 확인 후만 진행.
- `.env` 파일은 *추후 Cafe24 이전 시점*의 systemd EnvironmentFile 템플릿 (§3 헤더
  박스 참조). 현재 Render/Aiven 데모에는 필요 없습니다.

---

본 문서는 운영자 인수인계 + Cafe24 이전 시점에 그대로 활용할 수 있도록 작성되었습니다. 실제 secret 은 별도 안전 저장소에서 관리하세요.
