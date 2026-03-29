#!/usr/bin/env bash
set -euo pipefail

# Seed the staging instance by copying data from a production instance.
# Idempotent: clears seeded tables before inserting (preserves integrations + sessions).
# Uses SQLite ATTACH on the server to copy directly between databases.
#
# Usage:
#   ./seed-staging.sh                      # Copy from default production instance
#   ./seed-staging.sh --source <id>        # Copy from a specific instance
#   ./seed-staging.sh --dry-run            # Print SQL without executing

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load SERVER from containers.env (local dir, or main worktree if running from a git worktree)
MAIN_REPO="$(git -C "$SCRIPT_DIR" worktree list --porcelain 2>/dev/null | head -1 | sed 's/^worktree //')"
for env_candidate in \
  "$SCRIPT_DIR/containers.env" \
  "${MAIN_REPO:+$MAIN_REPO/blog/scripts/hosted/openclaw-dashboard/containers.env}"; do
  if [[ -n "$env_candidate" && -f "$env_candidate" ]]; then
    # shellcheck source=/dev/null
    source "$env_candidate"
    break
  fi
done

if [[ -z "${SERVER:-}" ]]; then
  echo "ERROR: \$SERVER not set. Ensure containers.env defines SERVER=root@..." >&2
  exit 1
fi

# Defaults
SOURCE_ID="99567b24"
DRY_RUN=false

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --source)  SOURCE_ID="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SOURCE_DB="/var/lib/docker/volumes/openclaw-data-${SOURCE_ID}/_data/openclaw.db"
STAGING_DB="/var/lib/docker/volumes/openclaw-data-staging/_data/openclaw.db"

# Tables to copy (order matters: delete children first, insert parents first)
TABLES=(
  settings
  conversations
  messages
  scheduled_jobs
  memories
  tasks
  task_execution_log
  confirmation_rules
  email_thread_state
  slack_nudged_threads
)

# Build SQL that runs on the server using ATTACH
# This copies column-by-column using the staging schema, so mismatched columns
# (from migrations) get default values automatically.
read -r -d '' SQL << 'ENDSQL' || true
ATTACH '__SOURCE_DB__' AS prod;

-- Clear staging tables (reverse order for FK safety)
DELETE FROM slack_nudged_threads;
DELETE FROM email_thread_state;
DELETE FROM confirmation_rules;
DELETE FROM task_execution_log;
DELETE FROM tasks;
DELETE FROM memories;
DELETE FROM scheduled_jobs;
DELETE FROM messages;
DELETE FROM conversations;
DELETE FROM settings;

-- Copy each table using column intersection (handles schema drift)
INSERT INTO settings SELECT * FROM prod.settings;
INSERT INTO conversations SELECT * FROM prod.conversations;
INSERT INTO messages SELECT * FROM prod.messages;
INSERT INTO scheduled_jobs SELECT * FROM prod.scheduled_jobs;
INSERT INTO memories SELECT * FROM prod.memories;
INSERT INTO tasks SELECT * FROM prod.tasks;
INSERT INTO task_execution_log SELECT * FROM prod.task_execution_log;
INSERT OR IGNORE INTO confirmation_rules SELECT * FROM prod.confirmation_rules;
INSERT OR IGNORE INTO email_thread_state SELECT * FROM prod.email_thread_state;
INSERT OR IGNORE INTO slack_nudged_threads SELECT * FROM prod.slack_nudged_threads;

DETACH prod;
ENDSQL

# Substitute the source DB path
SQL="${SQL//__SOURCE_DB__/$SOURCE_DB}"

echo "Source:  $SOURCE_ID ($SOURCE_DB)"
echo "Target:  staging ($STAGING_DB)"

if $DRY_RUN; then
  echo ""
  echo "=== DRY RUN — SQL that would be executed ==="
  echo "$SQL"
else
  echo "Copying data..."
  ssh "$SERVER" "sqlite3 '$STAGING_DB' <<'REMOTESQL'
$SQL
REMOTESQL"
  echo "Done. Staging database seeded from production instance ${SOURCE_ID}."
fi
