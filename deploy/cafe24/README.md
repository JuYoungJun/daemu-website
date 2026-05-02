# Cafe24 VPS 배포 — 30분 가이드

> Cafe24 클라우드 서버(Ubuntu 22.04 LTS) 구매 후 처음 ssh 접속한 시점부터 첫 배포까지.
> 서버: 1Core / 1GB / SSD 50GB (월 ~9,900원) 기준. 트래픽 늘면 콘솔에서 한 클릭 업그레이드.

## 0. 준비물 체크리스트

- [ ] Cafe24 클라우드 서버 인스턴스 (Ubuntu 22.04, 공인 IP 발급)
- [ ] 도메인 (`example.daemu.kr` 가정 — 실제 구매 도메인으로 치환)
- [ ] DNS 관리 권한 (Cafe24 my페이지 또는 Cloudflare)
- [ ] Aiven MySQL Service 가 가동 중 (DATABASE_URL + CA PEM 보유)
- [ ] Resend API 키 (선택, 이메일 발송용)
- [ ] 로컬에 ssh keypair (`~/.ssh/id_ed25519` 또는 별도)

## 1. 도메인 → 서버 IP 연결 (DNS)

```
Type   Host                Value                  TTL
─────  ──────────────────  ─────────────────────  ─────
A      example.daemu.kr    <서버 공인 IP>         600
A      www                 <서버 공인 IP>         600
```

> ⚠️ Aiven 의 "Allowed IP addresses" 에 서버 공인 IP 를 추가해야 DB 연결 가능. (Aiven Console → Service → "Allowed IP addresses" → Add)

## 2. 서버 첫 진입 + 초기 셋업

### a) ssh 접속 (root 받은 비밀번호 사용)

```bash
ssh root@<서버IP>
```

### b) sudo 쓸 운영자 계정 생성 + ssh key 등록

```bash
# 본인 PC 의 ~/.ssh/id_ed25519.pub 내용을 서버에 등록
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "ssh-ed25519 AAAA... 본인_pubkey" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### c) 본 저장소 clone + setup.sh 실행

```bash
cd /tmp
git clone https://github.com/JuYoungJun/daemu-website.git
cd daemu-website
sudo bash deploy/cafe24/setup.sh
```

`setup.sh` 가 자동으로 처리하는 것:
- python3.11 + node20 + nginx + certbot 설치
- Asia/Seoul + ko_KR.UTF-8 로케일
- 2GB swap (1GB 인스턴스 OOM 방지)
- ufw 방화벽 22/80/443 만 허용 + fail2ban
- 운영 사용자 `daemu` 생성, `/srv/daemu/{backend,frontend,logs,backups,uploads}` 트리
- systemd unit `daemu-backend.service` 설치 (아직 시작 X — .env 작성 후)
- nginx site `/etc/nginx/sites-available/daemu` 설치 (HTTP only, 80 → 443 redirect 준비)
- 일일 백업 cron `/etc/cron.d/daemu-backup`

소요 시간: ~5분.

## 3. 도메인 placeholder 일괄 치환

`example.daemu.kr` 을 실제 도메인으로:

```bash
DOMAIN="<your-domain>"          # 예: daemu.kr
sudo sed -i "s/example\.daemu\.kr/$DOMAIN/g" /etc/nginx/sites-available/daemu
sudo nginx -t && sudo systemctl reload nginx
```

## 4. 백엔드 .env 작성

```bash
sudo cp /tmp/daemu-website/deploy/cafe24/.env.example /srv/daemu/backend/.env
sudo nano /srv/daemu/backend/.env
```

**필수 교체값**:
- `DATABASE_URL` (Aiven Service URI 그대로)
- `MYSQL_SSL_CA` (Aiven Console → "CA Certificate" download → 그대로 붙여넣기)
- `JWT_SECRET` (`openssl rand -hex 32` 결과)
- `SHORT_LINK_HMAC_SECRET` (`openssl rand -hex 32` 결과)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` 등 시드 계정
- `RESEND_API_KEY` (Resend 사용 시)
- `ALLOWED_ORIGINS` / `PUBLIC_BASE_URL` (실제 도메인)

저장 후 권한 보호:
```bash
sudo chown daemu:daemu /srv/daemu/backend/.env
sudo chmod 600 /srv/daemu/backend/.env
```

## 5. 첫 배포 (로컬 PC 에서 실행)

```bash
# 1) 환경변수 설정 (한 번만)
cat >> ~/.daemu-deploy.env <<EOF
export DEPLOY_HOST=$DOMAIN
export DEPLOY_USER=daemu
export DEPLOY_KEY_PATH=$HOME/.ssh/id_ed25519
export DEPLOY_PORT=22
EOF

# 2) daemu 가 sudo systemctl/nginx 를 비밀번호 없이 실행할 수 있도록.
#    (서버에서 실행)
ssh root@<서버IP> 'cat > /etc/sudoers.d/daemu-deploy <<EOL
daemu ALL=(root) NOPASSWD: /bin/systemctl restart daemu-backend, /bin/systemctl reload nginx, /usr/sbin/service nginx reload
EOL
chmod 440 /etc/sudoers.d/daemu-deploy'

# 3) 로컬에서 배포 실행
cd ~/path/to/daemu-website
bash deploy/cafe24/deploy.sh
```

`deploy.sh` 가 처리:
1. `npm run build` (Vite dist/)
2. dist/ → `/srv/daemu/frontend/` rsync
3. backend-py/ → `/srv/daemu/backend/` rsync (uploads, .venv 제외)
4. 원격에서 venv 갱신 + `systemctl restart daemu-backend` + `nginx -s reload`
5. 사후 헬스체크 — `databaseConnected:true` 확인

소요 시간: ~3분 (첫 빌드 포함).

## 6. HTTPS 발급 (Let's Encrypt)

DNS 가 서버 IP 를 가리키는 게 확인되면:

```bash
sudo certbot --nginx \
  -d $DOMAIN -d www.$DOMAIN \
  --non-interactive --agree-tos -m admin@$DOMAIN \
  --redirect
```

certbot 이 nginx 설정을 자동으로 갱신해 443 listen + cert path 채움. 자동 갱신 cron 도 자동 등록.

## 7. 첫 부팅 검증 (8가지 체크)

```bash
# 1) backend health
curl -fsS https://$DOMAIN/api/health | jq '{ok, databaseConnected, emailProvider}'
# → {"ok":true, "databaseConnected":true, "emailProvider":"resend"}

# 2) 프론트
curl -I https://$DOMAIN/  # 200 OK

# 3) admin 로그인
# 브라우저 → https://$DOMAIN/admin → admin@... / .env 의 ADMIN_PASSWORD

# 4) systemd
ssh daemu@$DOMAIN 'sudo systemctl status daemu-backend'
# → active (running)

# 5) journalctl
ssh daemu@$DOMAIN 'sudo journalctl -u daemu-backend -n 20'

# 6) nginx
sudo nginx -t && systemctl status nginx

# 7) 백업 cron
ssh daemu@$DOMAIN 'cat /etc/cron.d/daemu-backup'
# → 30 3 * * * daemu /usr/local/bin/daemu-backup.sh ...

# 8) 인증서 만료일
sudo certbot certificates | grep "Expiry Date"
```

## 8. 운영 명령어 cheatsheet

```bash
# 백엔드 재시작
sudo systemctl restart daemu-backend

# 로그 실시간
sudo journalctl -u daemu-backend -f

# nginx 설정 reload
sudo nginx -t && sudo systemctl reload nginx

# 디스크 / 메모리
df -h && free -m

# 수동 백업 1회
sudo -u daemu /usr/local/bin/daemu-backup.sh

# 백업 목록
ls -lh /srv/daemu/backups/db/ /srv/daemu/backups/uploads/

# 인증서 갱신 dry-run
sudo certbot renew --dry-run
```

## 9. 비용 (월)

| 항목 | 가격 |
|---|---|
| Cafe24 클라우드 1Core/1GB | ~9,900원 |
| 도메인 (Cafe24 .kr) | ~1,830원 (연 22,000원) |
| Aiven MySQL Free Tier (1GB) | 0원 |
| Resend Free (3,000통/월) | 0원 |
| **합계** | **~12,000원** |

트래픽 늘면 인스턴스만 업그레이드. Aiven 도 1GB → 4GB 유료 전환 시 $30/월 정도.

## 10. 트러블슈팅

| 증상 | 원인 / 조치 |
|---|---|
| `databaseConnected: false` | Aiven IP allowlist 에 서버 공인 IP 누락. Aiven Console 에 추가. |
| `Access denied for user 'avnadmin'` | 비밀번호의 url-unsafe 문자. 자동 url-encode 가 동작했는지 logs 확인. 또는 Aiven 콘솔에서 비밀번호 reset. |
| `caching_sha2_password` 핸드셰이크 실패 | `.env` 의 `MYSQL_DRIVER=aiomysql` 로 변경 + restart. |
| 502 Bad Gateway | uvicorn 죽음. `journalctl -u daemu-backend -n 50` 으로 에러 확인. |
| `address already in use` | systemd 이중 실행. `systemctl stop daemu-backend` 후 `pgrep -af uvicorn` 으로 좀비 확인. |
| nginx `connect() failed` | systemd unit 의 port 와 nginx `proxy_pass` port 불일치. 둘 다 8001. |
| 인증서 만료 알림 | `certbot.timer` 가 죽었는지 확인 + `systemctl status certbot.timer`. |
| QR redirect 만 500 | 백엔드 logs 의 `[short-links] rid=...` 검색. tz-aware 비교 / DB 연결 잠시 단절 가능. |
| admin 새로고침 시 자동 로그아웃 | `JWT_SECRET` env 미설정. 재배포마다 secret 이 갱신됨. fix: 고정값 set. |

## 11. 롤백

```bash
# 직전 커밋으로 되돌리기
cd ~/path/to/daemu-website
git checkout HEAD~1 -- backend-py/
bash deploy/cafe24/deploy.sh

# 또는 서버에서 직접 systemd 만 정지
ssh daemu@$DOMAIN 'sudo systemctl stop daemu-backend'

# 백업 DB 로 복원 (재해 복구)
ssh daemu@$DOMAIN
gunzip < /srv/daemu/backups/db/daemu-YYYYMMDD-HHMM.sql.gz \
  | mysql --host=<aiven-host> --user=<user> --password=<pass> --ssl-mode=VERIFY_CA --ssl-ca=<ca.pem> defaultdb
```

## 12. CI/CD 확장 (선택)

`deploy.sh` 를 GitHub Actions 로 자동화하려면 `.github/workflows/cafe24-deploy.yml` 의 secrets 에:
- `CAFE24_HOST`
- `CAFE24_USER` (`daemu`)
- `CAFE24_PORT` (`22`)
- `CAFE24_SSH_KEY` (deploy 키 private content)

main 푸시 시 자동 배포. (이미 본 저장소에 워크플로 파일이 있음)

---

**Quick start 요약** (정상 케이스):
1. DNS A record (5분)
2. `ssh root@<IP>` → `sudo bash deploy/cafe24/setup.sh` (5분)
3. `/srv/daemu/backend/.env` 작성 (5분)
4. 로컬에서 `bash deploy/cafe24/deploy.sh` (3분)
5. `sudo certbot --nginx -d ...` (2분)
6. `https://$DOMAIN/api/health` 검증 (1분)

**총 ~20분**. 이후 push 마다 `bash deploy/cafe24/deploy.sh` 한 줄.

---

## 13. 운영 GO 직전 검증 체크리스트 (Junior 가 따라하는 SOP)

본 10단계를 모두 ✅ 표시한 후 클라이언트에게 URL 을 전달하세요.
각 단계에서 실패하면 그 단계의 "실패 시" 부분으로 이동.

### 단계 1: backend 프로세스 살아있는가
```bash
ssh daemu@<서버IP>
sudo systemctl status daemu-backend
```
- ✅ `Active: active (running)` 확인
- 실패 시: `sudo journalctl -u daemu-backend -n 100 --no-pager` → 마지막 에러 확인. ENV/secret 누락이면 `[auth] ENV=prod 인데 필수 secret 미설정: [...]` 메시지 — 그 키 .env 에 추가 후 재시작.

### 단계 2: frontend 정적 파일 nginx 가 서빙하는가
```bash
curl -fsSI https://<도메인>/ | head -5
```
- ✅ `HTTP/2 200` + `content-type: text/html` 확인
- 실패 시: `sudo nginx -t` (config 검증) + `sudo tail -50 /var/log/nginx/error.log`. dist/ 가 비어있으면 로컬에서 `bash deploy/cafe24/deploy.sh` 다시 실행.

### 단계 3: 공개 /api/health 가 최소 정보만 반환
```bash
curl -fsS https://<도메인>/api/health
```
- ✅ **정확히 `{"ok":true}`** 만 출력 (그 외 키 없어야 함)
- 실패 시 (이메일 provider / DB URL 등이 보이면): backend 가 옛 코드. `git log` 로 Phase 1 commit 확인 후 redeploy.

### 단계 4: /api/admin/health 가 인증 강제
```bash
curl -fsS -o /dev/null -w "%{http_code}\n" https://<도메인>/api/admin/health
```
- ✅ `401` (또는 `403`) 출력 — 인증 없이 접근 차단
- 실패 시 (200 이 나오면): backend 가 옛 코드 — Phase 1 commit `2c9571c` 이후로 deploy 됐는지 확인.

### 단계 5: 어드민 로그인이 ADMIN_PASSWORD 로 동작
```bash
curl -fsS -X POST https://<도메인>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@daemu.kr","password":"<ADMIN_PASSWORD>"}' | head -c 200
```
- ✅ `{"token":"eyJ...","user":{...}}` 응답 (token 시작은 `eyJ`)
- 실패 시: `.env` 의 `ADMIN_PASSWORD` 값 확인. 약한 default (daemu1234 등) 면 fail-closed 가 차단했을 수 있음 — `journalctl` 의 RuntimeError 메시지 확인.

### 단계 6: CORS 가 운영 도메인만 허용
```bash
# 정상 origin
curl -fsS -H 'Origin: https://<운영도메인>' \
  -X OPTIONS https://<도메인>/api/auth/login -I | grep -i access-control
# 잘못된 origin
curl -fsS -H 'Origin: https://evil.example.com' \
  -X OPTIONS https://<도메인>/api/auth/login -I | grep -i access-control
```
- ✅ 정상 origin → `Access-Control-Allow-Origin: https://<운영도메인>` 헤더
- ✅ 잘못된 origin → 헤더 없음 (또는 거부)
- 실패 시 (와일드카드 `*` 또는 모든 origin 허용): `.env` 의 `ALLOWED_ORIGINS` 콤마 구분으로 정확히 등록.

### 단계 7: logs 에 secret 노출 없는지
```bash
sudo journalctl -u daemu-backend --since "10 minutes ago" --no-pager | \
  grep -iE 'password|secret|token|api[_-]?key|jwt|smtp_pass|cookie|authorization' | head
```
- ✅ 출력 0줄 (또는 `[REDACTED]` / mask 된 형태만)
- 실패 시: 실제 secret 노출이면 즉시 회전 (`JWT_SECRET` / `ADMIN_PASSWORD` 새로 생성 → `.env` 교체 → `systemctl restart daemu-backend`)

### 단계 8: DB 연결 정상
```bash
# admin 토큰으로 admin/health 조회
TOKEN=$(curl -fsS -X POST https://<도메인>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@daemu.kr","password":"<ADMIN_PASSWORD>"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
curl -fsS https://<도메인>/api/admin/health -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
- ✅ `"databaseConnected": true` 확인
- 실패 시 (`databaseConnected: false`): `.env` 의 `DATABASE_URL` + `MYSQL_SSL_CA` 확인. Aiven 등 외부 DB 면 IP allowlist 에 서버 IP 등록.

### 단계 9: 메일 발송이 설정대로 동작
```bash
# admin/health 의 emailProvider 확인 (위 단계 8 의 응답 안에)
# resend / smtp / none 셋 중 하나
```
- ✅ `"emailProvider": "resend"` 또는 `"smtp"` (운영 정상)
- ⚠️ `"emailProvider": "none"` 이면 모든 발송이 simulated — RESEND_API_KEY 또는 SMTP_HOST/USER/PASS 등록 필요.

### 단계 10: 업로드 파일 검증 동작
```bash
# 위험 확장자 .html 업로드 시도 (admin token 필요)
curl -fsS -o /dev/null -w "%{http_code}\n" -X POST https://<도메인>/api/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"filename":"evil.html","content":"PGgxPmhpPC9oMT4="}'
```
- ✅ `415` (실행 가능 / 스크립트 형식 차단) 응답
- 실패 시 (200 응답): backend 가 옛 코드 — Phase 2 commit `5f72392` 이후로 deploy 됐는지 확인.

---

## 14. 롤백 가이드

배포 후 문제 발견 시:

### 즉시 롤백 (이전 commit 으로)
```bash
ssh daemu@<서버IP>
cd /srv/daemu/backend
git log --oneline -5  # 직전 안전 commit SHA 확인
git reset --hard <안전한_SHA>
sudo systemctl restart daemu-backend
sudo systemctl reload nginx
```

### 임시 maintenance 모드
```bash
sudo systemctl stop daemu-backend
# nginx 가 502 반환 — 사용자에겐 maintenance 페이지 노출
# 문제 fix 후
sudo systemctl start daemu-backend
```

### log / health 모니터링 명령
```bash
# 실시간 backend logs
sudo journalctl -u daemu-backend -f

# 실시간 nginx access
sudo tail -f /var/log/nginx/access.log

# 실시간 nginx error
sudo tail -f /var/log/nginx/error.log

# health 1분 polling
watch -n 60 'curl -fsS https://<도메인>/api/health'
```

---

## 15. Cafe24 vs Render 정책 (오해 방지)

본 프로젝트의 정식 운영 호스팅은 **Cafe24 VPS** 입니다.

| 호스팅 | 용도 | 권장도 |
|---|---|---|
| **Cafe24 VPS** | 운영 (production) | ⭐⭐⭐⭐⭐ — 본 README 가이드 사용 |
| Render | backend 만 임시 테스트 / 디버그 | ⭐⭐ — 서비스 검증용. 정식 운영 X |
| GitHub Pages | demo branch 의 frontend 만 | ⭐⭐⭐ — 클라이언트 시연용 |
| `archive/backend-cf` | **사용 금지** (참조용 archived) | ❌ 절대 deploy X |

운영 GO 시점에는 Render 를 끄고 Cafe24 단일 호스트로 통합. `render.yaml` 은 호환성 유지를 위해 남기지만 운영 배포에 사용하지 마세요.

---

## 16. 정식 운영 GO 후 정기 점검 (월 1회 권장)

- [ ] `sudo systemctl status daemu-backend nginx` 모두 active
- [ ] DB 백업 mysqldump 가 `/srv/daemu/backups/` 에 14일 분 있음
- [ ] `sudo certbot certificates` SSL 만료일 60일+
- [ ] secret rotation: `JWT_SECRET` 6개월, `ADMIN_PASSWORD` 90일
- [ ] disk 사용량 `df -h` 80% 미만
- [ ] `sudo journalctl -u daemu-backend --since "1 month ago" | grep -i error | wc -l` 비정상 누적 확인
- [ ] `/admin/security` 의 audit logs / suspicious events 검토
