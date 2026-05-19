# Secret Rotation Runbook

> 운영 cutover 직전 또는 사고 (의심 노출) 발생 시 따라 실행. 운영자 1인
> 가정. 정기 rotation 권장 주기는 항목별로 명시.

---

## 0. 사전 점검

- 이 문서는 **민감 정보 (실 키 값) 자체를 적지 않음**. 절차만 기술.
- 모든 secret 은 Render Dashboard 또는 Cafe24 VPS `/srv/daemu/backend/.env`
  파일 (perm 600) 에만 존재. git tracked X.
- 회전 작업 중 **반드시 staging 에서 먼저 검증** → 운영 적용.
- 키 회전 후 backend 가 부팅 실패하면 즉시 옛 값으로 rollback (Render
  은 envvar 직전 값 history 유지).

---

## 1. JWT_SECRET

**역할**: 어드민/파트너 JWT 토큰 서명. 노출 시 누구나 토큰 위조 가능.

**회전 주기**: 12개월 또는 의심 노출 직후.

**부수효과**: 회전 즉시 **모든 활성 세션 무효화** (운영자/파트너 다시 로그인 필요).

**절차**:
```bash
# 1) 새 secret 생성 (64 char hex, 충분히 강함)
python3 -c "import secrets; print(secrets.token_hex(32))"

# 2) Render Dashboard → daemu-py → Environment → JWT_SECRET 값을 위 출력으로 교체 → Save
#    Render 가 자동 재배포. 30~60초 후 활성.
#    또는 Cafe24 의 경우:
#    sudo nano /srv/daemu/backend/.env
#    JWT_SECRET=<새 값>
#    sudo systemctl restart daemu-api

# 3) 검증 — /api/health 가 ok 응답하면 부팅 성공.
curl https://daemu-py.onrender.com/api/health

# 4) 운영자 / 활성 파트너에게 재로그인 안내 메시지 (필요 시).
```

**기준 미달 secret 으로 부팅 거부**: `backend-py/auth.py:233` 의 fail-closed
체크가 짧거나 약한 secret 을 reject. 새 secret 은 반드시 32 byte 이상 entropy.

---

## 2. ADMIN_PASSWORD (초기 슈퍼관리자 비번 seed)

**역할**: 첫 부팅 시 admin row 생성 비번. **운영자가 비번 변경 후엔 영향 0**.

**회전 주기**: 운영자가 처음 로그인 + 비번 변경 즉시 ADMIN_PASSWORD env 를 **삭제** (재시드 불필요).

**절차**:
```bash
# 처음 어드민 진입 → 강제 비번 변경 화면 → 강한 비번 설정.
# 그 후:
#   Render: Environment → ADMIN_PASSWORD 항목 Delete → Save (재배포 1회).
#   Cafe24: .env 에서 라인 삭제 → systemctl restart.
```

---

## 3. RESEND_API_KEY (이메일 발송)

**역할**: 자동 회신 / 캠페인 / 발주 안내 메일 발송. 노출 시 attacker 가
DAEMU 도메인으로 스팸 발송 가능.

**회전 주기**: 6개월 또는 노출 직후.

**절차**:
```bash
# 1) https://resend.com/api-keys → 새 key 발급.
# 2) 새 key 발급된 즉시 옛 key revoke (대시보드).
# 3) Render dashboard 의 RESEND_API_KEY 값 교체 → Save → 재배포.
# 4) 검증: 어드민 /admin/mail 에서 테스트 발송 → outbox 에 'sent' 표시.
```

**Tip**: Resend 무료 plan 은 verified domain 필요. `daemu.kr` 도메인 받은 후
DNS TXT 레코드 등록 필수 (Resend dashboard → Domains 페이지에 절차 안내).

---

## 4. DATABASE_URL (DB 접속 문자열)

**역할**: MySQL credentials. 노출 시 DB 직접 접근 → 모든 PII 유출.

**회전 주기**: 12개월 또는 노출 직후. DB 호스트 변경 (Aiven → Cafe24) 시도 회전.

**절차**:
```bash
# 1) Aiven console → Users → 새 user 생성 또는 기존 user 비번 reset.
#    또는 Cafe24 mysql:
#    sudo mysql -e "ALTER USER 'daemu'@'%' IDENTIFIED BY '<새 비번>';"
#
# 2) 새 DATABASE_URL 조립 — 형식:
#    mysql+aiomysql://USER:PASS@HOST:PORT/daemu
#
# 3) Render / Cafe24 env 갱신 → 재배포.
#
# 4) 검증 — backend log 의 "✓ DB connection OK".
```

⚠ DATABASE_URL 회전 중에는 **새 user 가 권한 받기 전 옛 user 가 살아있어야**
재배포 fail 회피. 즉:
1. 새 user 생성 + GRANT
2. DATABASE_URL env 갱신 + 재배포 검증
3. 옛 user DROP (다음 점검 일정 때)

---

## 5. SNYK_TOKEN, PSI_API_KEY (CI 스캐너)

**역할**: GitHub Actions 의 보안 스캐너 호출용. 노출 시 attacker 가 Snyk
계정의 organization scan limit 소진 가능 (low impact).

**회전 주기**: 12개월.

**절차**:
```bash
# Snyk: dashboard → Account → API token → Regenerate.
# PSI: console.cloud.google.com → APIs & Services → Credentials → 새 key.
# GitHub repo → Settings → Secrets and variables → Actions → 값 교체.
```

---

## 6. CAFE24_SSH_KEY (도메인 받은 후 cafe24 deploy 활성화 시)

**역할**: GitHub Actions 가 VPS 에 SSH 접속하는 private key.

**회전 주기**: 6개월 또는 노출 직후.

**절차**:
```bash
# 1) VPS 에서 새 keypair 생성:
ssh-keygen -t ed25519 -f /tmp/daemu_deploy -C "daemu-gha-deploy"

# 2) public key 를 ~/.ssh/authorized_keys 에 등록:
cat /tmp/daemu_deploy.pub >> ~daemu/.ssh/authorized_keys

# 3) GitHub Secrets 에서 CAFE24_SSH_KEY 값을 /tmp/daemu_deploy (private) 로 교체.

# 4) 검증 — workflow_dispatch 로 cafe24-deploy.yml 수동 실행 → 성공 확인.

# 5) 옛 public key 라인 authorized_keys 에서 제거.
```

---

## 7. 의심 노출 시 비상 대응 (모든 secret 동시 회전)

다음 중 하나라도 발견 시 위 1~6 모든 secret 즉시 회전:

- git history 에 secret leak 흔적
- 운영자 컴퓨터 분실/도난
- 어드민 의심 로그인 ( `/admin/security` 의 `EventStreamPanel` 에서 unfamiliar IP)
- 의심 outbound 트래픽 (Render logs / Cafe24 access logs)

**순서**:
1. `daemu-py` 일시 suspend (Render dashboard 의 Suspend 버튼 → 트래픽 차단)
2. JWT_SECRET, DATABASE_URL 회전 (위 절차)
3. 활성 세션 강제 종료 — DB 의 `admin_users` 모두 `last_login_at = NULL` UPDATE
4. RESEND_API_KEY 회전 + Resend dashboard 의 최근 발송 로그 검토
5. /admin/security 의 `EventStreamPanel` 24h 분량 CSV export → 운영자 보관
6. 사고 보고서: `docs/INCIDENT_<YYYY-MM-DD>.md` 작성 (이 파일 git 추적 X, 운영자 로컬만)

---

## 점검 체크리스트 (분기 1회)

- [ ] 모든 secret 의 last_rotated_at 추적 (운영자 본인 메모 또는 Aiven console 의 audit log)
- [ ] Render envvar 페이지 스크린샷 (변동 사항 추적)
- [ ] GH Secrets 페이지 점검 (Snyk, PSI, SSH 등 unused secret 정리)
- [ ] DAEMU_LOCKDOWN_DEMO_ACCOUNTS=true 운영 cutover 후 적용됐는지
