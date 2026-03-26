#!/bin/bash
set -euo pipefail

# =============================================================================
# OpenClaw Backup — Backs up all instance databases + provisioning DB + config
#
# Runs on the Hetzner server. Designed for nightly cron.
# Uses SQLite .backup for safe hot copies (no downtime needed).
#
# Storage: S3-compatible (AWS S3, Backblaze B2, etc.)
# Retention: 30 days by default
#
# Usage:
#   ./backup.sh                    # Full backup of everything
#   ./backup.sh --instances-only   # Only instance databases
#   ./backup.sh --dry-run          # Show what would be backed up
#
# Setup:
#   1. Install aws CLI: apt-get install awscli
#   2. Configure: aws configure (or set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY)
#   3. For Backblaze B2: set S3_ENDPOINT in env
#   4. Add to crontab:
#      0 3 * * * /opt/agentpost/backup.sh >> /opt/agentpost/logs/backup.log 2>&1
# =============================================================================

# --- Configuration ---
BACKUP_BUCKET="${BACKUP_BUCKET:-s3://agentpost-backups}"
S3_ENDPOINT="${S3_ENDPOINT:-}"  # e.g. https://s3.us-west-004.backblazeb2.com for B2
RETENTION_DAYS="${RETENTION_DAYS:-30}"
PROVISIONING_DB="${PROVISIONING_DB:-/opt/agentpost/data/instances.db}"
BACKUP_TMP="/tmp/agentpost-backup-$$"
DATE=$(date -u +"%Y-%m-%d_%H%M%S")
DRY_RUN=false
INSTANCES_ONLY=false

# S3 command builder
s3cmd() {
  if [ -n "$S3_ENDPOINT" ]; then
    aws s3 "$@" --endpoint-url "$S3_ENDPOINT"
  else
    aws s3 "$@"
  fi
}

# Parse args
for arg in "$@"; do
  case "$arg" in
    --dry-run)       DRY_RUN=true ;;
    --instances-only) INSTANCES_ONLY=true ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

echo "=== OpenClaw Backup — $DATE ==="

# Cleanup on exit
trap 'rm -rf "$BACKUP_TMP"' EXIT
mkdir -p "$BACKUP_TMP"

TOTAL_SIZE=0

# --- 1. Provisioning DB ---
if [ "$INSTANCES_ONLY" = false ]; then
  echo ""
  echo "--- Provisioning DB ---"
  if [ -f "$PROVISIONING_DB" ]; then
    DEST="$BACKUP_TMP/provisioning/instances.db"
    mkdir -p "$BACKUP_TMP/provisioning"
    if [ "$DRY_RUN" = true ]; then
      echo "  [dry-run] Would backup: $PROVISIONING_DB"
    else
      sqlite3 "$PROVISIONING_DB" ".backup '$DEST'"
      SIZE=$(stat -c%s "$DEST" 2>/dev/null || stat -f%z "$DEST")
      TOTAL_SIZE=$((TOTAL_SIZE + SIZE))
      echo "  Backed up provisioning DB ($(numfmt --to=iec $SIZE 2>/dev/null || echo "${SIZE}B"))"
    fi
  else
    echo "  WARNING: Provisioning DB not found at $PROVISIONING_DB"
  fi
fi

# --- 2. Config files ---
if [ "$INSTANCES_ONLY" = false ]; then
  echo ""
  echo "--- Config files ---"
  mkdir -p "$BACKUP_TMP/config"
  for CONF_FILE in /opt/agentpost/Caddyfile /opt/agentpost/containers.env; do
    if [ -f "$CONF_FILE" ]; then
      if [ "$DRY_RUN" = true ]; then
        echo "  [dry-run] Would backup: $CONF_FILE"
      else
        cp "$CONF_FILE" "$BACKUP_TMP/config/"
        echo "  Backed up $(basename "$CONF_FILE")"
      fi
    fi
  done
fi

# --- 3. Instance databases ---
echo ""
echo "--- Instance databases ---"

# Get running instances from provisioning DB
if [ -f "$PROVISIONING_DB" ]; then
  INSTANCES=$(sqlite3 "$PROVISIONING_DB" "SELECT id FROM instances WHERE status IN ('running', 'suspended');" 2>/dev/null || echo "")
else
  # Fallback: scan Docker volumes
  INSTANCES=$(docker volume ls --format '{{.Name}}' | grep '^openclaw-data-' | sed 's/^openclaw-data-//')
fi

if [ -z "$INSTANCES" ]; then
  echo "  No instances found."
else
  INSTANCE_COUNT=0
  while IFS= read -r ID; do
    [ -z "$ID" ] && continue
    INSTANCE_COUNT=$((INSTANCE_COUNT + 1))

    VOLUME_PATH="/var/lib/docker/volumes/openclaw-data-${ID}/_data"
    DB_FILE="$VOLUME_PATH/openclaw.db"

    if [ ! -f "$DB_FILE" ]; then
      echo "  [$ID] WARNING: DB not found at $DB_FILE — skipping"
      continue
    fi

    if [ "$DRY_RUN" = true ]; then
      echo "  [$ID] [dry-run] Would backup: $DB_FILE"
      continue
    fi

    DEST_DIR="$BACKUP_TMP/instances/$ID"
    mkdir -p "$DEST_DIR"

    # Safe hot backup using SQLite .backup command
    sqlite3 "$DB_FILE" ".backup '$DEST_DIR/openclaw.db'"
    SIZE=$(stat -c%s "$DEST_DIR/openclaw.db" 2>/dev/null || stat -f%z "$DEST_DIR/openclaw.db")
    TOTAL_SIZE=$((TOTAL_SIZE + SIZE))
    echo "  [$ID] Backed up ($(numfmt --to=iec $SIZE 2>/dev/null || echo "${SIZE}B"))"
  done <<< "$INSTANCES"
  echo "  $INSTANCE_COUNT instance(s) processed"
fi

# --- 4. Compress and upload ---
if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "[dry-run] Would compress and upload to $BACKUP_BUCKET/backups/$DATE.tar.gz"
  echo "[dry-run] Would prune backups older than $RETENTION_DAYS days"
  exit 0
fi

echo ""
echo "--- Compressing ---"
ARCHIVE="/tmp/agentpost-backup-${DATE}.tar.gz"
tar -czf "$ARCHIVE" -C "$BACKUP_TMP" .
ARCHIVE_SIZE=$(stat -c%s "$ARCHIVE" 2>/dev/null || stat -f%z "$ARCHIVE")
echo "  Archive: $(numfmt --to=iec $ARCHIVE_SIZE 2>/dev/null || echo "${ARCHIVE_SIZE}B")"

echo ""
echo "--- Uploading to $BACKUP_BUCKET ---"
s3cmd cp "$ARCHIVE" "$BACKUP_BUCKET/backups/$DATE.tar.gz"
rm -f "$ARCHIVE"
echo "  Uploaded: backups/$DATE.tar.gz"

# --- 5. Prune old backups ---
echo ""
echo "--- Pruning backups older than $RETENTION_DAYS days ---"
CUTOFF=$(date -u -d "$RETENTION_DAYS days ago" +"%Y-%m-%d" 2>/dev/null || date -u -v-${RETENTION_DAYS}d +"%Y-%m-%d")

s3cmd ls "$BACKUP_BUCKET/backups/" | awk '{print $NF}' | while read -r KEY; do
  BASENAME=$(basename "$KEY" .tar.gz)
  BACKUP_DATE=$(echo "$BASENAME" | grep -oP '^\d{4}-\d{2}-\d{2}' || echo "")
  if [ -n "$BACKUP_DATE" ] && [[ "$BACKUP_DATE" < "$CUTOFF" ]]; then
    echo "  Deleting old backup: $KEY"
    s3cmd rm "$KEY"
  fi
done

echo ""
echo "=== Backup complete ==="
echo "  Total data: $(numfmt --to=iec $TOTAL_SIZE 2>/dev/null || echo "${TOTAL_SIZE}B")"
echo "  Archive: backups/$DATE.tar.gz"
