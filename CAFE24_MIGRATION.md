# 카페24 가상서버(VPS) 마이그레이션 가이드

대무 사이트를 카페24 **가상서버 호스팅 (Linux VPS)** 으로 옮길 때 필요한 모든 단계.
가상서버는 root 권한이 제공되므로 **백엔드(Python/FastAPI) + 프론트엔드(정적 빌드) + MySQL + nginx + Let's Encrypt SSL**을
한 서버에 모두 올릴 수 있습니다.

> 참고: https://hosting.cafe24.com/?controller=new_product_page&page=virtual

---

## 1. 추천 상품 (1대로 모든 것 운영)

| 사양 | 가격 (월) | 추천 용도 |
|---|---|---|
| **1Core / 1GB / SSD 50GB** (Standard) | ~9,900원 | ✅ **데모/초기 운영 — 본 가이드 기준** |
| 2Core / 2GB / SSD 100GB | ~16,500원 | 일 방문 1만+ 시 |
| 4Core / 4GB / SSD 100GB | ~33,000원 | 본격 운영 |

**결정**: 1Core/1GB로 시작 → 트래픽 늘면 한 클릭 업그레이드.

### 추가로 필요한 것
- **카페24 도메인** (`daemu.kr` 등) — 약 22,000원/년 (월 ~1,830원)
- **Resend 무료 티어** — 월 3,000통, 자체 도메인 verify 후 모든 수신자에 발송 가능
- **총 운영 비용**: **월 ~12,000원**, 연 ~14만원

---

## 2. VPS 셋업 — 한 시간 안에 운영 시작

### 단계 0: VPS 신청 + SSH 접속

1. https://hosting.cafe24.com/?controller=new_product_page&page=virtual → "1Core/1GB Linux" 신청
2. 카페24 my페이지 → 가상서버 → 접속 정보 받기 (호스트명/포트/root 비번)
3. SSH 접속:
   ```bash
   ssh root@your-vps-host.cafe24.com -p 22
   ```
4. 첫 접속 시 root 비번 변경 필수.

### 단계 1: 기본 패키지 설치 + 운영용 사용자

```bash
# 시스템 업데이트
apt update && apt upgrade -y

# 필수 패키지
apt install -y git python3.12 python3.12-venv python3-pip \
  mysql-server nginx certbot python3-certbot-nginx \
  ufw fail2ban build-essential libssl-dev libffi-dev

# 운영용 사용자 생성 (root로 직접 띄우면 위험)
adduser daemu --disabled-password --gecos ""
usermod -aG sudo daemu

# SSH 키 복사
mkdir -p /home/daemu/.ssh
cp /root/.ssh/authorized_keys /home/daemu/.ssh/
chown -R daemu:daemu /home/daemu/.ssh
chmod 700 /home/daemu/.ssh
chmod 600 /home/daemu/.ssh/authorized_keys

# 방화벽
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

### 단계 2: MySQL 설정

```bash
# 보안 초기화
mysql_secure_installation
# - root 비번 설정
# - anonymous user 제거 → Y
# - root 원격 차단 → Y
# - test DB 제거 → Y
# - 권한 reload → Y

# 대무 DB + 사용자 생성
mysql -u root -p <<'SQL'
CREATE DATABASE daemu CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'daemu_app'@'localhost' IDENTIFIED BY 'STRONG_DB_PASSWORD_HERE';
GRANT ALL PRIVILEGES ON daemu.* TO 'daemu_app'@'localhost';
FLUSH PRIVILEGES;
SQL
```

### 단계 3: 백엔드 배포 (운영 사용자로)

```bash
# 운영 사용자로 전환
sudo -i -u daemu

# 코드 받기
cd ~
git clone https://github.com/JuYoungJun/daemu-website.git
cd daemu-website/backend-py

# Python 가상환경
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 환경변수 파일 (root 권한 필요)
exit  # daemu → root로 복귀
cat > /etc/daemu-api.env <<'EOF'
DATABASE_URL=mysql+asyncmy://daemu_app:STRONG_DB_PASSWORD_HERE@127.0.0.1:3306/daemu
JWT_SECRET=PASTE_OUTPUT_OF_openssl_rand_-hex_32
ENV=prod
ALLOWED_ORIGINS=https://daemu.kr,https://www.daemu.kr
PUBLIC_BASE_URL=https://api.daemu.kr
ADMIN_EMAIL=admin@daemu.kr
ADMIN_PASSWORD=ChooseYourStrongAdminPassword
TESTER_EMAIL=tester@daemu.kr
TESTER_PASSWORD=ChooseYourTesterPassword
DEVELOPER_EMAIL=dev@daemu.kr
DEVELOPER_PASSWORD=ChooseYourDeveloperPassword
RESEND_API_KEY=re_yourkey
FROM_EMAIL=DAEMU <hi@daemu.kr>
TRUST_FORWARDED_FOR=1
INQUIRY_RETENTION_DAYS=1095
OUTBOX_RETENTION_DAYS=365
EOF
chmod 600 /etc/daemu-api.env
chown daemu:daemu /etc/daemu-api.env
```

### 단계 4: systemd 서비스 등록

```bash
cat > /etc/systemd/system/daemu-api.service <<'EOF'
[Unit]
Description=DAEMU FastAPI backend (uvicorn)
After=network.target mysql.service
Wants=mysql.service

[Service]
Type=simple
User=daemu
Group=daemu
WorkingDirectory=/home/daemu/daemu-website/backend-py
EnvironmentFile=/etc/daemu-api.env
ExecStart=/home/daemu/daemu-website/backend-py/venv/bin/uvicorn main:app \
  --host 127.0.0.1 --port 8000 --workers 2 --proxy-headers --forwarded-allow-ips='*'
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/daemu/daemu-website/backend-py
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable daemu-api
systemctl start daemu-api
systemctl status daemu-api    # active (running) 확인
journalctl -u daemu-api -f    # 로그 실시간 확인
```

첫 부팅 시 backend가 `Base.metadata.create_all`로 모든 테이블을 만들고 슈퍼관리자 자동 시드.

### 단계 5: 프론트엔드 빌드 + 배포

```bash
sudo -i -u daemu
cd ~/daemu-website

# Node 20 설치 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 의존성 + 빌드
npm ci
VITE_API_BASE_URL=https://api.daemu.kr VITE_SITE_BASE_URL=https://daemu.kr npm run build

# 배포 위치
sudo mkdir -p /var/www/daemu
sudo cp -r dist/* /var/www/daemu/
sudo chown -R www-data:www-data /var/www/daemu

# SPA 404 → index.html (이미 deploy-pages.yml에서 만든 redirect 404.html 활용)
sudo cp dist/404.html /var/www/daemu/404.html
```

### 단계 6: nginx 리버스 프록시 + SSL

```bash
exit  # daemu → root

# 1) 프론트엔드 (daemu.kr)
cat > /etc/nginx/sites-available/daemu.kr <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name daemu.kr www.daemu.kr;
    root /var/www/daemu;
    index index.html;

    # SPA fallback — /admin/* 같은 경로도 index.html로 라우팅
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 정적 자산 1년 캐시
    location ~* \.(?:js|css|png|jpg|jpeg|gif|webp|svg|ico|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 보안 헤더 (백엔드 CSP는 별도 적용)
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
EOF

# 2) 백엔드 (api.daemu.kr → uvicorn :8000)
cat > /etc/nginx/sites-available/api.daemu.kr <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name api.daemu.kr;

    client_max_body_size 60M;   # 영상 업로드 50MB + 여유

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_buffering off;
    }
}
EOF

ln -s /etc/nginx/sites-available/daemu.kr /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/api.daemu.kr /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

### 단계 7: SSL (Let's Encrypt)

도메인 DNS가 VPS IP를 가리키도록 먼저 설정 (단계 8 참조). 그 다음:

```bash
certbot --nginx -d daemu.kr -d www.daemu.kr -d api.daemu.kr \
  --non-interactive --agree-tos -m admin@daemu.kr
# 자동 갱신 (cron 등록은 certbot이 자동 설정)
systemctl status certbot.timer
```

### 단계 8: 카페24 도메인 DNS 설정

카페24 my페이지 → 도메인 → DNS 관리:

| Type | Host | Target | TTL |
|---|---|---|---|
| A | @ | (VPS의 공인 IP) | 600 |
| A | www | (VPS의 공인 IP) | 600 |
| A | api | (VPS의 공인 IP) | 600 |
| MX | @ | (메일 사용 시 — Resend는 SPF만 필요) | 600 |

DNS 전파 5분 ~ 24시간 후 https://daemu.kr 접속 가능.

### 단계 9: Resend 도메인 verify

이미 발급한 Resend API 키로 도메인 verify:

1. https://resend.com/domains/add → `daemu.kr` 추가
2. 표시된 DNS 레코드를 카페24 DNS에 추가:

| Type | Host | Content |
|---|---|---|
| TXT | `resend._domainkey` | (DKIM 키 전체) |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` priority 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none;` |

3. 5분 ~ 24시간 후 Resend가 자동 verify
4. systemctl restart daemu-api (FROM_EMAIL이 적용되도록)
5. **테스트**: `curl https://api.daemu.kr/api/health` → `from: DAEMU <hi@daemu.kr>` 확인

---

## 3. CI/CD — 코드 push만 하면 자동 배포

GitHub Actions에서 SSH로 VPS에 배포하는 워크플로 추가. (`.github/workflows/cafe24-deploy.yml`)

### 사전 준비
1. VPS에서 SSH key pair 발급:
   ```bash
   ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_deploy -N ""
   cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
   ```
2. 개인키(`~/.ssh/github_deploy`) 내용을 GitHub repo Settings → Secrets → Actions에:
   - `CAFE24_SSH_KEY` (전체 키 내용)
   - `CAFE24_HOST` (예: `your-vps-host.cafe24.com`)
   - `CAFE24_USER` (`daemu`)
   - `CAFE24_PORT` (보통 22)

### 워크플로 — 자동 배포

`.github/workflows/cafe24-deploy.yml`을 별도로 만들어 main push 시 자동으로:
1. 프론트엔드 빌드 → `/var/www/daemu/`로 rsync
2. 백엔드 코드 git pull + pip install → `systemctl restart daemu-api`

**주의**: 운영 환경은 staging에서 검증 후 main만 자동 배포되도록 분리 권장.

(자세한 워크플로 yaml은 본 가이드의 부록 참조 또는 첫 배포 후 별도 작성)

---

## 4. 운영 체크리스트

배포 후 다음 8가지 확인:

- [ ] `https://daemu.kr/` 메인 페이지 표시
- [ ] `https://daemu.kr/admin` 슈퍼관리자 로그인 정상
- [ ] `https://api.daemu.kr/api/health` → `database: mysql+asyncmy://...` + `from: DAEMU <hi@daemu.kr>`
- [ ] Contact 폼 제출 → admin/inquiries 표시 + 자동회신 메일 도착
- [ ] 발주 → admin/orders 표시 + 상태 변경 작동
- [ ] 계약서 발송 → 수신자 메일 + /sign/ 링크 정상
- [ ] systemctl restart daemu-api 후 데이터 영속 (사라지지 않음)
- [ ] Lighthouse 90+ 점수 (이미 달성)

---

## 5. 운영 명령어 모음

```bash
# 백엔드 재시작
sudo systemctl restart daemu-api

# 백엔드 로그 실시간 확인
sudo journalctl -u daemu-api -f

# 백엔드 코드 업데이트 (수동)
sudo -i -u daemu
cd ~/daemu-website
git pull
cd backend-py
source venv/bin/activate
pip install -r requirements.txt --upgrade
exit
sudo systemctl restart daemu-api

# 프론트엔드 재빌드 (수동)
sudo -i -u daemu
cd ~/daemu-website
git pull
npm ci && VITE_API_BASE_URL=https://api.daemu.kr VITE_SITE_BASE_URL=https://daemu.kr npm run build
sudo cp -r dist/* /var/www/daemu/
sudo cp dist/404.html /var/www/daemu/404.html

# DB 백업 (cron으로 매일 자동화 권장)
mysqldump -u root -p daemu | gzip > /var/backups/daemu-$(date +%Y%m%d).sql.gz

# 디스크 사용량
df -h
du -sh /home/daemu/daemu-website/backend-py/uploads/

# nginx reload (설정 변경 시)
sudo nginx -t && sudo systemctl reload nginx

# SSL 갱신 확인
sudo certbot renew --dry-run
```

---

## 6. DB 자동 백업 (필수)

```bash
sudo cat > /etc/cron.daily/daemu-db-backup <<'EOF'
#!/bin/bash
mkdir -p /var/backups/daemu
mysqldump -u root daemu | gzip > /var/backups/daemu/daemu-$(date +\%Y\%m\%d).sql.gz
# 30일 이상된 백업 자동 삭제
find /var/backups/daemu -mtime +30 -delete
EOF
sudo chmod +x /etc/cron.daily/daemu-db-backup
```

> root 비번을 cron에 두지 않기 위해 `~/.my.cnf` 설정 권장:
> ```
> [client]
> user=root
> password=YOUR_ROOT_PASSWORD
> ```
> chmod 600.

---

## 7. 모니터링 / 알림 (선택)

- **백엔드 health 체크**: cron으로 `curl https://api.daemu.kr/api/health` 실패 시 알림 발송
- **Uptimerobot 무료 티어** — 5분 간격 외부 모니터링 (이메일/Slack 알림)
- **journalctl** + **logrotate** — 로그 30일 보관

---

## 8. 비용 요약 (월)

| 항목 | 가격 |
|---|---|
| 카페24 가상서버 1Core/1GB Linux | ~9,900원 |
| 카페24 도메인 `daemu.kr` | ~1,830원 (연 22,000원) |
| Resend 무료 티어 (월 3,000통) | 0원 |
| **총합** | **~12,000원** |

트래픽 늘면 가상서버만 업그레이드 (다운타임 거의 없음).

---

## 9. 마이그레이션 단계 요약 (현재 → 카페24 VPS)

1. ✅ 도메인 발급
2. ✅ 카페24 가상서버 1Core/1GB Linux 신청
3. ✅ VPS SSH 접속 → MySQL 설치 + DB 생성
4. ✅ 코드 git clone + Python venv + uvicorn systemd
5. ✅ nginx 리버스 프록시 + SPA fallback
6. ✅ Let's Encrypt SSL
7. ✅ DNS A 레코드 (@/www/api → VPS IP)
8. ✅ Resend 도메인 verify
9. ✅ DB 자동 백업 cron
10. ✅ Uptimerobot 외부 모니터링 (선택)

본 가이드 내용을 차례로 따라가면 **2~4시간 내 본격 운영 환경 구축** 완료.
