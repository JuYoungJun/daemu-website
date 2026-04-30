#!/usr/bin/env bash
# 로컬 → Cafe24 VPS 배포 스크립트.
#
# 사용:
#   1) 첫 사용 전: 환경변수 export (또는 ~/.daemu-deploy.env 작성):
#        export DEPLOY_HOST=example.daemu.kr            (또는 IP)
#        export DEPLOY_USER=daemu
#        export DEPLOY_KEY_PATH=~/.ssh/daemu_cafe24
#        export DEPLOY_PORT=22                          (옵션)
#        export DEPLOY_HEALTH_URL=https://example.daemu.kr/api/health  (옵션)
#
#   2) 실행:  bash deploy/cafe24/deploy.sh
#
# 동작:
#   - 프론트 빌드 (npm run build)
#   - rsync 로 dist/ → /srv/daemu/frontend/
#   - rsync 로 backend-py/ → /srv/daemu/backend/  (uploads, .venv, __pycache__ 제외)
#   - 원격에서 pip install -r requirements.txt (변경 있을 때만)
#   - systemctl restart daemu-backend && nginx -s reload
#   - 배포 직전/직후 헬스체크 — 실패하면 rollback hint 출력

set -euo pipefail

# ── 0) 환경변수 / 설정 ────────────────────────────────────────────
[[ -f "$HOME/.daemu-deploy.env" ]] && source "$HOME/.daemu-deploy.env"

: "${DEPLOY_HOST:?DEPLOY_HOST 가 set 되지 않음 (export DEPLOY_HOST=example.daemu.kr)}"
: "${DEPLOY_USER:=daemu}"
: "${DEPLOY_KEY_PATH:=$HOME/.ssh/id_ed25519}"
: "${DEPLOY_PORT:=22}"
: "${DEPLOY_HEALTH_URL:=https://${DEPLOY_HOST}/api/health}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

SSH_OPTS=(-i "$DEPLOY_KEY_PATH" -p "$DEPLOY_PORT" -o StrictHostKeyChecking=accept-new)
SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"

c_g(){ printf "\033[1;32m%s\033[0m\n" "$*"; }
c_r(){ printf "\033[1;31m%s\033[0m\n" "$*"; }
c_y(){ printf "\033[1;33m%s\033[0m\n" "$*"; }

# ── 1) 사전 헬스체크 (현재 운영 상태) ─────────────────────────────
c_y "[1/6] 배포 직전 헬스체크 — $DEPLOY_HEALTH_URL"
PRE_OK=$(curl -fsS --max-time 8 "$DEPLOY_HEALTH_URL" 2>/dev/null | jq -r '.databaseConnected // false' || echo "false")
echo "  databaseConnected: $PRE_OK"

# ── 2) 프론트 빌드 ────────────────────────────────────────────────
c_y "[2/6] frontend 빌드 (npm run build)..."
if [[ ! -f node_modules/.package-lock.json ]] || [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
  npm ci --no-audit --prefer-offline
fi
VITE_API_BASE_URL="https://${DEPLOY_HOST}" \
VITE_SITE_BASE_URL="https://${DEPLOY_HOST}" \
  npm run build
[[ -f dist/index.html ]] || { c_r "❌ dist/index.html 누락 — 빌드 실패"; exit 1; }

# ── 3) 프론트 rsync ───────────────────────────────────────────────
c_y "[3/6] frontend rsync → /srv/daemu/frontend/"
rsync -azv --delete --no-owner --no-group \
  -e "ssh ${SSH_OPTS[*]}" \
  dist/ \
  "${SSH_TARGET}:/srv/daemu/frontend/"

# ── 4) 백엔드 rsync ───────────────────────────────────────────────
c_y "[4/6] backend rsync → /srv/daemu/backend/"
rsync -azv --no-owner --no-group \
  --exclude '__pycache__/' --exclude '*.pyc' \
  --exclude '.venv/' --exclude 'venv/' \
  --exclude 'uploads/' --exclude 'daemu.db*' \
  --exclude '.env' --exclude '*.log' \
  -e "ssh ${SSH_OPTS[*]}" \
  backend-py/ \
  "${SSH_TARGET}:/srv/daemu/backend/"

# ── 5) 원격에서 venv 갱신 + 재시작 ─────────────────────────────────
c_y "[5/6] venv 갱신 + systemd restart..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" bash <<'REMOTE'
set -euo pipefail
cd /srv/daemu/backend

# venv 없으면 생성
if [[ ! -d .venv ]]; then
  python3.11 -m venv .venv
fi

# requirements 변경 시에만 install (해시 비교)
SUM_FILE=.venv/requirements.sha256
NEW_SUM=$(sha256sum requirements.txt | awk '{print $1}')
if [[ ! -f "$SUM_FILE" ]] || [[ "$(cat "$SUM_FILE" 2>/dev/null)" != "$NEW_SUM" ]]; then
  echo "  requirements 변경 감지 — pip install"
  .venv/bin/pip install --upgrade pip setuptools wheel
  .venv/bin/pip install -r requirements.txt
  echo "$NEW_SUM" > "$SUM_FILE"
else
  echo "  requirements 동일 — pip install 생략"
fi

# uploads / logs 디렉토리 보장
mkdir -p /srv/daemu/uploads /srv/daemu/logs

# systemd 재시작 (sudo 필요 — visudo 로 daemu 에 NOPASSWD 등록 권장)
sudo /bin/systemctl restart daemu-backend
sudo /bin/systemctl reload nginx
REMOTE

# ── 6) 사후 헬스체크 ──────────────────────────────────────────────
c_y "[6/6] 사후 헬스체크 (5초 대기 후)..."
sleep 5
HEALTH=$(curl -fsS --max-time 10 "$DEPLOY_HEALTH_URL" 2>/dev/null || echo "{}")
DB_OK=$(echo "$HEALTH" | jq -r '.databaseConnected // false')
VERSION=$(echo "$HEALTH" | jq -r '.version // "?"')
EMAIL=$(echo "$HEALTH" | jq -r '.emailProvider // "?"')

if [[ "$DB_OK" == "true" ]]; then
  c_g "✅ 배포 완료. version=$VERSION, db=connected, email=$EMAIL"
  exit 0
fi

c_r "⚠ 배포 후 헬스체크 실패. databaseConnected=$DB_OK"
echo "  ── rollback 가이드 ──"
echo "  1) 백엔드 logs:  ssh $SSH_TARGET 'sudo journalctl -u daemu-backend -n 80 --no-pager'"
echo "  2) 직전 commit 으로 되돌리기:"
echo "       cd $REPO_ROOT && git checkout HEAD~1 -- backend-py/"
echo "       bash deploy/cafe24/deploy.sh"
echo "  3) 또는 원격에서 직접:"
echo "       ssh $SSH_TARGET 'sudo systemctl status daemu-backend'"
exit 2
