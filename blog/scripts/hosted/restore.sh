#!/bin/bash
set -euo pipefail

# =============================================================================
# OpenClaw Restore — Restores from a backup archive
#
# Usage:
#   ./restore.sh                          # List available backups
#   ./restore.sh 2026-03-25_030000        # Restore everything from that backup
#   ./restore.sh 2026-03-25_030000 abc123 # Restore a single instance
#   ./restore.sh --latest                 # Restore from most recent backup
#   ./restore.sh --latest abc123          # Restore single instance from latest
#
# What it restores:
#   - Provisioning DB → /opt/agentpost/data/instances.db
#   - Instance DBs → Docker volumes (openclaw-data-{id})
#   - Config files → /opt/agentpost/ (Caddyfile, containers.env)
#
# Safety:
#   - Stops containers before restoring their DBs
#   - Creates a pre-restore snapshot in /opt/agentpost/data/pre-restore/
#   - Asks for confirmation before overwriting
# =============================================================================

BACKUP_BUCKET="${BACKUP_BUCKET:-s3://agentpost-backups}"
S3_ENDPOINT="${S3_ENDPOINT:-}"
RESTORE_TMP="/tmp/agentpost-restore-$$"

s3cmd() {
  if [ -n "$S3_ENDPOINT" ]; then
    aws s3 "$@" --endpoint-url "$S3_ENDPOINT"
  else
    aws s3 "$@"
  fi
}

trap 'rm -rf "$RESTORE_TMP"' EXIT

# --- Parse args ---
TARGET_BACKUP="${1:-}"
TARGET_INSTANCE="${2:-}"

# --- List mode ---
if [ -z "$TARGET_BACKUP" ]; then
  echo "=== Available Backups ==="
  echo ""
  s3cmd ls "$BACKUP_BUCKET/backups/" | sort -r | head -30 | while read -r LINE; do
    SIZE=$(echo "$LINE" | awk '{print $3}')
    FILE=$(basename "$(echo "$LINE" | awk '{print $NF}')" .tar.gz)
    echo "  $FILE  ($(numfmt --to=iec "$SIZE" 2>/dev/null || echo "${SIZE}B"))"
  done
  echo ""
  echo "Usage: $0 <backup-name> [instance-id]"
  echo "       $0 --latest [instance-id]"
  exit 0
fi

# --- Resolve --latest ---
if [ "$TARGET_BACKUP" = "--latest" ]; then
  echo "Finding latest backup..."
  TARGET_BACKUP=$(s3cmd ls "$BACKUP_BUCKET/backups/" | sort -r | head -1 | awk '{print $NF}' | xargs basename | sed 's/.tar.gz$//')
  if [ -z "$TARGET_BACKUP" ]; then
    echo "ERROR: No backups found in $BACKUP_BUCKET/backups/"
    exit 1
  fi
  echo "Latest: $TARGET_BACKUP"
fi

echo "=== OpenClaw Restore ==="
echo "  Backup: $TARGET_BACKUP"
[ -n "$TARGET_INSTANCE" ] && echo "  Instance: $TARGET_INSTANCE" || echo "  Scope: everything"
echo ""

# --- Download and extract ---
echo "--- Downloading backup ---"
mkdir -p "$RESTORE_TMP"
ARCHIVE="$RESTORE_TMP/backup.tar.gz"
s3cmd cp "$BACKUP_BUCKET/backups/${TARGET_BACKUP}.tar.gz" "$ARCHIVE"
echo "  Downloaded."

echo "--- Extracting ---"
tar -xzf "$ARCHIVE" -C "$RESTORE_TMP"
rm -f "$ARCHIVE"

# Show contents
echo "  Contents:"
[ -d "$RESTORE_TMP/provisioning" ] && echo "    - Provisioning DB"
[ -d "$RESTORE_TMP/config" ] && echo "    - Config files: $(ls "$RESTORE_TMP/config/" 2>/dev/null | tr '\n' ' ')"
if [ -d "$RESTORE_TMP/instances" ]; then
  INST_COUNT=$(ls "$RESTORE_TMP/instances/" 2>/dev/null | wc -l | tr -d ' ')
  echo "    - $INST_COUNT instance database(s)"
  ls "$RESTORE_TMP/instances/" 2>/dev/null | while read -r ID; do
    echo "      - $ID"
  done
fi
echo ""

# --- Confirmation ---
if [ -t 0 ]; then
  if [ -n "$TARGET_INSTANCE" ]; then
    echo "This will restore instance '$TARGET_INSTANCE' from backup '$TARGET_BACKUP'."
  else
    echo "This will restore ALL data from backup '$TARGET_BACKUP'."
  fi
  read -p "Continue? (y/N) " -n 1 -r </dev/tty
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# --- Pre-restore snapshot ---
PRE_RESTORE="/opt/agentpost/data/pre-restore/$(date -u +%Y%m%d_%H%M%S)"
mkdir -p "$PRE_RESTORE"
echo "--- Saving pre-restore snapshot to $PRE_RESTORE ---"

# --- Restore provisioning DB ---
if [ -z "$TARGET_INSTANCE" ] && [ -f "$RESTORE_TMP/provisioning/instances.db" ]; then
  echo ""
  echo "--- Restoring provisioning DB ---"
  PROV_DB="/opt/agentpost/data/instances.db"
  if [ -f "$PROV_DB" ]; then
    cp "$PROV_DB" "$PRE_RESTORE/instances.db"
    # Also grab WAL files
    [ -f "${PROV_DB}-wal" ] && cp "${PROV_DB}-wal" "$PRE_RESTORE/"
    [ -f "${PROV_DB}-shm" ] && cp "${PROV_DB}-shm" "$PRE_RESTORE/"
    echo "  Saved current provisioning DB to pre-restore snapshot"
  fi
  cp "$RESTORE_TMP/provisioning/instances.db" "$PROV_DB"
  # Remove stale WAL/SHM — SQLite will recreate them
  rm -f "${PROV_DB}-wal" "${PROV_DB}-shm"
  echo "  Restored provisioning DB"
fi

# --- Restore config files ---
if [ -z "$TARGET_INSTANCE" ] && [ -d "$RESTORE_TMP/config" ]; then
  echo ""
  echo "--- Restoring config files ---"
  for CONF_FILE in "$RESTORE_TMP/config/"*; do
    BASENAME=$(basename "$CONF_FILE")
    DEST="/opt/agentpost/$BASENAME"
    if [ -f "$DEST" ]; then
      cp "$DEST" "$PRE_RESTORE/$BASENAME"
    fi
    cp "$CONF_FILE" "$DEST"
    echo "  Restored $BASENAME"
  done
fi

# --- Restore instance databases ---
if [ -d "$RESTORE_TMP/instances" ]; then
  echo ""
  echo "--- Restoring instance databases ---"

  # Determine which instances to restore
  if [ -n "$TARGET_INSTANCE" ]; then
    INSTANCES="$TARGET_INSTANCE"
    if [ ! -d "$RESTORE_TMP/instances/$TARGET_INSTANCE" ]; then
      echo "  ERROR: Instance '$TARGET_INSTANCE' not found in this backup."
      echo "  Available: $(ls "$RESTORE_TMP/instances/" 2>/dev/null | tr '\n' ' ')"
      exit 1
    fi
  else
    INSTANCES=$(ls "$RESTORE_TMP/instances/" 2>/dev/null)
  fi

  for ID in $INSTANCES; do
    SRC="$RESTORE_TMP/instances/$ID/openclaw.db"
    VOLUME_PATH="/var/lib/docker/volumes/openclaw-data-${ID}/_data"
    DEST="$VOLUME_PATH/openclaw.db"

    if [ ! -f "$SRC" ]; then
      echo "  [$ID] WARNING: No DB in backup — skipping"
      continue
    fi

    # Stop container if running
    CONTAINER="openclaw-$ID"
    WAS_RUNNING=false
    if docker inspect "$CONTAINER" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
      echo "  [$ID] Stopping container..."
      docker stop "$CONTAINER" --time 10
      WAS_RUNNING=true
    fi

    # Create volume if it doesn't exist (new instance from backup)
    if [ ! -d "$VOLUME_PATH" ]; then
      echo "  [$ID] Creating Docker volume..."
      docker volume create "openclaw-data-$ID"
    fi

    # Snapshot current DB
    if [ -f "$DEST" ]; then
      mkdir -p "$PRE_RESTORE/instances/$ID"
      cp "$DEST" "$PRE_RESTORE/instances/$ID/openclaw.db"
    fi

    # Restore
    cp "$SRC" "$DEST"
    rm -f "${DEST}-wal" "${DEST}-shm"
    echo "  [$ID] Restored database"

    # Restart container if it was running
    if [ "$WAS_RUNNING" = true ]; then
      echo "  [$ID] Restarting container..."
      docker start "$CONTAINER"

      # Quick health check
      PORT=$(docker port "$CONTAINER" 3000 2>/dev/null | head -1 | cut -d: -f2 || echo "")
      if [ -n "$PORT" ]; then
        sleep 2
        if curl -sf "http://localhost:$PORT/health" --max-time 5 >/dev/null 2>&1; then
          echo "  [$ID] Healthy"
        else
          echo "  [$ID] WARNING: Failed health check after restore"
        fi
      fi
    fi
  done
fi

echo ""
echo "=== Restore complete ==="
echo "  Pre-restore snapshot: $PRE_RESTORE"
echo ""
echo "If something went wrong, restore the pre-restore snapshot:"
echo "  cp $PRE_RESTORE/instances.db /opt/agentpost/data/instances.db"
echo "  # For each instance:"
echo "  cp $PRE_RESTORE/instances/<id>/openclaw.db /var/lib/docker/volumes/openclaw-data-<id>/_data/openclaw.db"
