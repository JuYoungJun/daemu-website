#!/usr/bin/env bash
# Cafe24 Cloud (Ubuntu 22.04 LTS) cold-start provisioning.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/JuYoungJun/daemu-website/main/deploy/cafe24/setup.sh | sudo bash
# OR
#   sudo bash setup.sh
#
# 결과: /srv/daemu/{backend,frontend,logs,backups} 트리, daemu user, nginx +
#   certbot + python3.11 + node20 설치, ufw + 방화벽, swap 2GB, 한국 시간대.
#   이 스크립트가 끝나면 .env 작성 후 deploy.sh 로 첫 배포 가능.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "❌ 이 스크립트는 root 로 실행해야 합니다 (sudo bash setup.sh)" >&2
  exit 1
fi

DAEMU_USER="daemu"
DAEMU_ROOT="/srv/daemu"

log() { echo -e "\033[1;36m[setup]\033[0m $*"; }

# ── 1) 시스템 업데이트 + 필수 패키지 ──────────────────────────────
log "apt update + 시스템 패키지 설치..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  software-properties-common ca-certificates curl wget git \
  build-essential pkg-config libssl-dev libffi-dev \
  ufw fail2ban \
  nginx \
  certbot python3-certbot-nginx \
  jq tzdata locales rsync \
  default-mysql-client

# Python 3.11 (Ubuntu 22.04 default 는 3.10 — deadsnakes ppa)
log "Python 3.11 설치..."
add-apt-repository -y ppa:deadsnakes/ppa
apt-get update -qq
apt-get install -y -qq python3.11 python3.11-venv python3.11-dev

# Node 20 (NodeSource) — frontend 빌드를 서버에서도 가능하게.
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | cut -d. -f1)" != "v20" ]]; then
  log "Node 20 설치..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

# ── 2) Locale + Timezone (Asia/Seoul, ko_KR.UTF-8) ────────────────
log "한국 시간대 + 로케일 설정..."
timedatectl set-timezone Asia/Seoul
locale-gen ko_KR.UTF-8 en_US.UTF-8 >/dev/null
update-locale LANG=ko_KR.UTF-8

# ── 3) Swap 2GB (1vCPU 1GB 인스턴스에서 빌드 OOM 방지) ────────────
if [[ ! -f /swapfile ]]; then
  log "Swap 2GB 생성..."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
  sysctl vm.swappiness=10 >/dev/null
  grep -q "^vm.swappiness" /etc/sysctl.conf || echo "vm.swappiness=10" >> /etc/sysctl.conf
fi

# ── 4) 운영 사용자 ────────────────────────────────────────────────
if ! id -u "$DAEMU_USER" >/dev/null 2>&1; then
  log "운영 사용자 '$DAEMU_USER' 생성..."
  adduser --system --group --shell /bin/bash --home "/home/$DAEMU_USER" "$DAEMU_USER"
fi

# ── 5) 디렉토리 트리 ──────────────────────────────────────────────
log "/srv/daemu 트리 생성..."
mkdir -p "$DAEMU_ROOT"/{backend,frontend,logs,backups,uploads}
chown -R "$DAEMU_USER:$DAEMU_USER" "$DAEMU_ROOT"
chmod 750 "$DAEMU_ROOT"

# uploads 는 nginx (www-data) 가 read 해야 함
chmod 755 "$DAEMU_ROOT/uploads"

# ── 6) 방화벽 ──────────────────────────────────────────────────────
log "ufw 방화벽 설정 (22, 80, 443 만 허용)..."
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

# fail2ban — SSH brute force 방어 기본 jail 활성화
systemctl enable --now fail2ban

# ── 7) systemd unit 설치 ──────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/daemu-backend.service" ]]; then
  log "daemu-backend.service 설치..."
  cp "$SCRIPT_DIR/daemu-backend.service" /etc/systemd/system/daemu-backend.service
  systemctl daemon-reload
fi

# ── 8) nginx site 설치 (HTTP only — HTTPS 는 certbot 후 자동 추가) ─
if [[ -f "$SCRIPT_DIR/nginx.conf" ]]; then
  log "nginx site 설치..."
  cp "$SCRIPT_DIR/nginx.conf" /etc/nginx/sites-available/daemu
  ln -sf /etc/nginx/sites-available/daemu /etc/nginx/sites-enabled/daemu
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
fi

# ── 9) certbot 자동 갱신 ──────────────────────────────────────────
systemctl enable --now certbot.timer 2>/dev/null || true

# ── 10) 백업 cron ─────────────────────────────────────────────────
if [[ -f "$SCRIPT_DIR/backup.sh" ]]; then
  log "일일 백업 cron 설치..."
  cp "$SCRIPT_DIR/backup.sh" /usr/local/bin/daemu-backup.sh
  chmod +x /usr/local/bin/daemu-backup.sh
  cat > /etc/cron.d/daemu-backup <<'CRON'
# DAEMU 일일 백업 — 매일 03:30 KST
30 3 * * * daemu /usr/local/bin/daemu-backup.sh >> /srv/daemu/logs/backup.log 2>&1
CRON
fi

log "✅ setup 완료. 다음 단계:"
echo "  1) /srv/daemu/backend/.env 작성 (deploy/cafe24/.env.example 참고)"
echo "  2) 로컬에서 deploy.sh 로 첫 배포"
echo "  3) DNS 가 가리키면 certbot --nginx -d example.daemu.kr -d api.example.daemu.kr"
echo "  4) systemctl start daemu-backend"
