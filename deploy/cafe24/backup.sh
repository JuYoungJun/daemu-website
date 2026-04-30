#!/usr/bin/env bash
# Cafe24 VPS 일일 백업 — /etc/cron.d/daemu-backup 에서 daemu 사용자로 실행.
#
# 백업 대상:
#   1) Aiven MySQL 전체 dump (gzip)
#   2) /srv/daemu/uploads/ tarball
#
# 보존: 14일 이상 된 백업은 자동 삭제.
# 위치: /srv/daemu/backups/{db,uploads}/
# 로그: /srv/daemu/logs/backup.log
#
# 환경:  /srv/daemu/backend/.env 의 DATABASE_URL 을 그대로 사용.
#        mysqldump 가 외부 Aiven 으로 연결하므로 SSL 옵션 필수.

set -euo pipefail

ENV_FILE="/srv/daemu/backend/.env"
BACKUP_ROOT="/srv/daemu/backups"
RETENTION_DAYS=14

[[ -r "$ENV_FILE" ]] || { echo "[backup] $ENV_FILE 읽기 실패"; exit 1; }

# .env 안전 source — 따옴표·다행 값 처리 위해 라인 단위로
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DATE_TAG="$(date +%Y%m%d-%H%M)"
DB_DIR="$BACKUP_ROOT/db"
UP_DIR="$BACKUP_ROOT/uploads"
mkdir -p "$DB_DIR" "$UP_DIR"

# ── 1) DB dump ────────────────────────────────────────────────────
# DATABASE_URL 이 mysql+aiomysql:// 로 normalize 된 형태일 수 있어 prefix strip.
RAW_URL="${DATABASE_URL#mysql+*://}"
RAW_URL="${RAW_URL#mysql://}"
# user:pass@host:port/db
USERPASS="${RAW_URL%%@*}"
HOSTDB="${RAW_URL#*@}"
USER="${USERPASS%%:*}"
PASS="${USERPASS#*:}"
HOSTPORT="${HOSTDB%%/*}"
DB="${HOSTDB#*/}"
DB="${DB%%\?*}"
HOST="${HOSTPORT%%:*}"
PORT="${HOSTPORT#*:}"
[[ "$PORT" == "$HOST" ]] && PORT=3306

# Aiven CA 를 임시 파일에 쓰기 (mysqldump 의 --ssl-ca 가 파일 경로 요구)
CA_TMP=""
if [[ -n "${MYSQL_SSL_CA:-}" ]]; then
  CA_TMP=$(mktemp)
  printf "%s" "$MYSQL_SSL_CA" > "$CA_TMP"
fi
trap '[[ -n "$CA_TMP" ]] && rm -f "$CA_TMP"' EXIT

DUMP_FILE="$DB_DIR/daemu-${DATE_TAG}.sql.gz"
echo "[backup] DB dump → $DUMP_FILE"
mysqldump \
  --host="$HOST" --port="$PORT" \
  --user="$USER" --password="$PASS" \
  ${CA_TMP:+--ssl-ca="$CA_TMP" --ssl-mode=VERIFY_CA} \
  --single-transaction --quick --lock-tables=false \
  --default-character-set=utf8mb4 \
  --routines --triggers --events \
  --no-tablespaces \
  "$DB" | gzip -9 > "$DUMP_FILE"

DB_BYTES=$(stat -c %s "$DUMP_FILE" 2>/dev/null || stat -f %z "$DUMP_FILE")
echo "[backup] DB dump 완료: $((DB_BYTES / 1024)) KB"

# ── 2) uploads tarball ────────────────────────────────────────────
UP_FILE="$UP_DIR/uploads-${DATE_TAG}.tar.gz"
if [[ -d /srv/daemu/uploads ]] && [[ -n "$(ls -A /srv/daemu/uploads 2>/dev/null)" ]]; then
  echo "[backup] uploads tarball → $UP_FILE"
  tar -C /srv/daemu -czf "$UP_FILE" uploads
  UP_BYTES=$(stat -c %s "$UP_FILE" 2>/dev/null || stat -f %z "$UP_FILE")
  echo "[backup] uploads 완료: $((UP_BYTES / 1024 / 1024)) MB"
else
  echo "[backup] uploads 비어있음 — 스킵"
fi

# ── 3) 14일 이상된 백업 삭제 ──────────────────────────────────────
find "$DB_DIR" -name 'daemu-*.sql.gz' -mtime +$RETENTION_DAYS -delete
find "$UP_DIR" -name 'uploads-*.tar.gz' -mtime +$RETENTION_DAYS -delete

echo "[backup] 완료 ($DATE_TAG)"
