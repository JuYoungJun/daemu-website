# 카페24 호스팅 마이그레이션 가이드

대무 사이트를 본격 운영용으로 카페24에 옮길 때 필요한 모든 단계.

---

## 1. 카페24에서 어떤 호스팅 상품을 사야 하나

**아키텍처 분리 원칙 — 프론트엔드와 백엔드를 별도로 운영합니다:**

| 구성요소 | 권장 호스팅 | 이유 |
|---|---|---|
| **프론트엔드** (정적 사이트) | 카페24 **광호스팅 절약형/일반형** (~월 1,100~3,300원) | Vite 빌드 결과물(dist/)만 업로드. CDN 캐싱 충분 |
| **백엔드** (FastAPI + Python) | 카페24 **매니지드 클라우드 호스팅 (Linux)** 또는 **Render 유료** ($7/월) | Python 3.12 + WSGI/ASGI 지원 필요 |
| **DB** (MySQL) | 카페24 **데이터베이스 단독 호스팅** 또는 **클라우드 호스팅에 포함된 MySQL** | utf8mb4 필수 |
| **도메인** | 카페24 도메인 등록 (예: `daemu.kr` ~월 1,500원) | DNS 자체 관리 |
| **이메일** | Resend(자체 도메인 verify 후) 또는 카페24 메일호스팅 | 자체 도메인으로 발송 |

### 가장 단순한 추천 구성 (총 월 ~12,000원)

1. **카페24 매니지드 클라우드 호스팅 (Linux 가상서버 1Core/1GB)** — Python + MySQL 모두 포함, 약 9,900원/월
2. **카페24 도메인** — `daemu.kr` 약 22,000원/년 (월 환산 ~1,830원)
3. **Resend** — 무료 (월 3,000통). 도메인 verify 후 모든 수신자 발송 가능

또는 백엔드만 Render 유료로 두고 프론트는 GitHub Pages 그대로 사용하는 하이브리드도 가능 (월 ~$7).

---

## 2. 마이그레이션 체크리스트

### 단계 1: 도메인 확보 (1일)

1. https://www.cafe24.com/?controller=hosting&service=domain 에서 `daemu.kr` 등 원하는 도메인 검색·구매
2. 카페24 my페이지 → 도메인 → DNS 관리 화면 확인 (나중에 사용)

### 단계 2: 카페24 매니지드 클라우드 호스팅 신청 (1일)

1. https://www.cafe24.com/?controller=hosting&service=cloud 에서 Linux 가상서버 신청
2. SSH 접속 정보 받기 (호스트명, 포트, ID, 비번)
3. MySQL 정보 받기:
   - host (보통 같은 서버 또는 별도 DB 서버)
   - port (3306)
   - user
   - password
   - database name (없으면 다음 명령으로 생성: `CREATE DATABASE daemu CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`)

### 단계 3: 백엔드 배포 (1일)

옵션 A — **Render 그대로 + DB만 카페24 MySQL** (가장 빠름):
```
# Render Dashboard → daemu-py → Environment 에서 변경
DATABASE_URL=mysql+asyncmy://daemu_user:비번@cafe24-mysql-host:3306/daemu
ALLOWED_ORIGINS=https://daemu.kr,https://www.daemu.kr
PUBLIC_BASE_URL=https://api.daemu.kr   # 또는 daemu-py.onrender.com 그대로
ENV=prod                                # ← 이걸 등록하면 demo 자동 시드 비활성화
JWT_SECRET=<openssl rand -hex 32 결과>
ADMIN_EMAIL=<운영 슈퍼관리자 이메일>
ADMIN_PASSWORD=<운영 슈퍼관리자 비번>
```
→ Render가 자동 redeploy, MySQL에 빈 테이블 자동 생성, 첫 로그인 시 비번 변경 강제.

옵션 B — **카페24 클라우드 호스팅에 백엔드 직접 배포**:
```bash
# SSH 접속 후
git clone https://github.com/JuYoungJun/daemu-website.git
cd daemu-website/backend-py
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 환경 변수 설정 (~/.bashrc 또는 systemd unit에)
export DATABASE_URL="mysql+asyncmy://daemu_user:pw@127.0.0.1:3306/daemu"
export JWT_SECRET="$(openssl rand -hex 32)"
export ALLOWED_ORIGINS="https://daemu.kr,https://www.daemu.kr"
export ENV=prod
export ADMIN_EMAIL="admin@daemu.kr"
export ADMIN_PASSWORD="<운영 비번>"
export RESEND_API_KEY="re_..."

# 백엔드 실행 (systemd 권장)
uvicorn main:app --host 0.0.0.0 --port 8000

# nginx 또는 카페24 reverse proxy로 https://api.daemu.kr → :8000 라우팅
```

systemd unit 예시 (`/etc/systemd/system/daemu-api.service`):
```ini
[Unit]
Description=DAEMU FastAPI backend
After=network.target

[Service]
Type=simple
User=daemu
WorkingDirectory=/home/daemu/daemu-website/backend-py
EnvironmentFile=/etc/daemu-api.env
ExecStart=/home/daemu/daemu-website/backend-py/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

### 단계 4: 프론트엔드 배포

옵션 A — **GitHub Pages 그대로** (변경 없음):
- GitHub repo Variables → `VITE_API_BASE_URL=https://daemu-py.onrender.com` (또는 https://api.daemu.kr)
- demo 브랜치에 push → 자동 deploy
- 카페24 도메인 DNS에 CNAME 추가:
  - `daemu.kr` → `juyoungjun.github.io` (apex는 A record 4개)
  - `www` → `juyoungjun.github.io`
- GitHub repo Settings → Pages → Custom domain `daemu.kr` 입력
- HTTPS 강제 체크

옵션 B — **카페24 광호스팅에 dist/ 업로드**:
```bash
npm run build
# dist/ 안 모든 파일을 카페24 광호스팅 web/ 디렉토리에 FTP 업로드
# 예: web/index.html, web/assets/*, web/vendor/gsap/*
```
- 카페24 my페이지 → 광호스팅 → FTP 정보 사용
- index.html SPA fallback: `.htaccess` 추가:
  ```
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
  ```

### 단계 5: DNS 설정 (1시간)

카페24 my페이지 → 도메인 → DNS 관리 → 다음 레코드 추가:

| Type | Host | Target | TTL |
|---|---|---|---|
| A | @ | (GitHub Pages 4개 IP 또는 카페24 호스팅 IP) | 600 |
| CNAME | www | juyoungjun.github.io. (또는 카페24 호스트) | 600 |
| CNAME | api | daemu-py.onrender.com. (백엔드 호스트) | 600 |

GitHub Pages용 IP 4개:
```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

### 단계 6: 이메일 — Resend 도메인 verify (30분)

1. https://resend.com/domains/add 에서 `daemu.kr` 추가
2. 표시되는 DNS 레코드 5개를 카페24 도메인 DNS에 그대로 추가:
   - DKIM (TXT) — `resend._domainkey.daemu.kr`
   - SPF (MX) — `send.daemu.kr` → `feedback-smtp.us-east-1.amazonses.com` priority 10
   - SPF (TXT) — `send.daemu.kr` → `v=spf1 include:amazonses.com ~all`
   - DMARC (TXT, 선택) — `_dmarc.daemu.kr` → `v=DMARC1; p=none;`
3. 5분 ~ 24시간 후 Resend가 자동 verify
4. Render env 변경:
   - `FROM_EMAIL=DAEMU <hi@daemu.kr>`
5. Test send → 모든 수신 도메인에 정상 발송

### 단계 7: DB 데이터 마이그레이션 (현재 SQLite → 카페24 MySQL)

현재 SQLite에 데이터가 거의 없으므로 (Render free tier 휘발) 사실상 **빈 DB로 시작**해도 무방. 만약 데이터가 있다면:

```bash
# Render 측 (SQLite dump)
sqlite3 daemu.db .dump > daemu_dump.sql

# 변환 (SQLite SQL → MySQL SQL)
python -c "
import re
src = open('daemu_dump.sql').read()
src = re.sub(r'AUTOINCREMENT', 'AUTO_INCREMENT', src)
src = re.sub(r'BEGIN TRANSACTION;|COMMIT;', '', src)
open('daemu_mysql.sql','w').write(src)
"

# 카페24 MySQL 측
mysql -h cafe24-mysql-host -u user -p daemu < daemu_mysql.sql
```

또는 더 간단: **빈 DB로 시작 + 백엔드 부팅 시 자동으로 테이블 생성** (`Base.metadata.create_all`)
+ 표준 템플릿 자동 시드 + 슈퍼관리자 시드.

---

## 3. 마이그레이션 후 검증 체크리스트

- [ ] `https://daemu.kr/` 접속 → 메인 페이지 표시
- [ ] `https://daemu.kr/admin` 로그인 → 슈퍼관리자 대시보드
- [ ] `https://api.daemu.kr/api/health` → `database: mysql+asyncmy://...`
- [ ] Contact 폼 제출 → admin/inquiries에 표시 + 자동회신 메일 도착
- [ ] 파트너 가입 신청 → admin/partners에서 확인
- [ ] 발주 → admin/orders 확인
- [ ] 계약서 발송 → 클라이언트 메일 도착 + /sign/ 링크 정상
- [ ] dyno 재시작 후 데이터 영속성 확인 (사라지면 안 됨)
- [ ] Snyk 보안 점검 통과
- [ ] Lighthouse 점수 90+ (이미 달성)

---

## 4. 비용 요약

| 항목 | 월 비용 | 연 비용 |
|---|---|---|
| 카페24 매니지드 클라우드 호스팅 (1Core/1GB) | ~9,900원 | ~118,800원 |
| 카페24 도메인 (`daemu.kr`) | ~1,830원 | ~22,000원 |
| Resend 무료 티어 (월 3,000통) | 0원 | 0원 |
| **총합** | **~12,000원** | **~140,800원** |

---

## 5. 향후 확장

- **트래픽 증가 시** 카페24 클라우드 호스팅 1Core → 2Core 업그레이드 (+5,000원/월)
- **DB 분리** 필요 시 카페24 데이터베이스 단독 호스팅 추가 (~5,000원/월)
- **CDN** 필요 시 Cloudflare 무료 티어 + 카페24 origin
- **백업** 카페24의 자동 백업 옵션 활성화 권장
