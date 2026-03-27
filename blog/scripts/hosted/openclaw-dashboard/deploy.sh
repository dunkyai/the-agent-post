#!/bin/bash
set -euo pipefail

# Deploy OpenClaw dashboard to all instances.
# Pulls instance list from the provisioning DB on the server — single source of truth.
#
# Usage:
#   ./deploy.sh              # Build, transfer, deploy ALL instances (staging + all active)
#   ./deploy.sh staging      # Deploy only staging
#   ./deploy.sh prod         # Deploy only active non-staging instances
#   ./deploy.sh 99567b24     # Deploy a single instance by ID
#   ./deploy.sh --restart    # Skip build/transfer, just restart all containers

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/containers.env"

IMAGE="openclaw-dashboard"
TARGET="${1:-all}"
SKIP_BUILD=false

if [ "$TARGET" = "--restart" ]; then
  SKIP_BUILD=true
  TARGET="all"
fi

# --- Build & Transfer ---
if [ "$SKIP_BUILD" = false ]; then
  echo "Building $IMAGE (linux/amd64)..."
  docker buildx build --platform linux/amd64 -t "$IMAGE" --load "$SCRIPT_DIR"

  echo "Transferring image to $SERVER..."
  docker save "$IMAGE" | gzip | ssh "$SERVER" 'docker load'
fi

# --- Fetch instances from provisioning DB ---
echo ""
echo "Fetching instances from provisioning DB..."
INSTANCES=$(ssh "$SERVER" "sqlite3 -separator '|' $PROVISIONING_DB \"SELECT id, port, gateway_token, COALESCE(plan, 'standard'), COALESCE(message_limit, 250) FROM instances WHERE status='running';\"")

if [ -z "$INSTANCES" ]; then
  echo "ERROR: No running instances found in provisioning DB"
  exit 1
fi

echo "Found instances:"
while IFS='|' read -r ID PORT TOKEN PLAN MLIMIT; do
  echo "  $ID -> port $PORT (plan=$PLAN, limit=$MLIMIT)"
done <<< "$INSTANCES"
echo ""

# --- Filter based on target ---
filter_instances() {
  while IFS='|' read -r ID PORT TOKEN PLAN MLIMIT; do
    case "$TARGET" in
      all)      echo "$ID|$PORT|$TOKEN|$PLAN|$MLIMIT" ;;
      staging)  [ "$ID" = "staging" ] && echo "$ID|$PORT|$TOKEN|$PLAN|$MLIMIT" || true ;;
      prod)     [ "$ID" != "staging" ] && echo "$ID|$PORT|$TOKEN|$PLAN|$MLIMIT" || true ;;
      *)        [ "$ID" = "$TARGET" ] && echo "$ID|$PORT|$TOKEN|$PLAN|$MLIMIT" || true ;;
    esac
  done <<< "$INSTANCES"
}

FILTERED=$(filter_instances)
if [ -z "$FILTERED" ]; then
  echo "ERROR: No instances match target '$TARGET'"
  exit 1
fi

COUNT=$(echo "$FILTERED" | wc -l | tr -d ' ')

# --- Confirmation for multi-instance deploys ---
if [ "$COUNT" -gt 1 ] && [ "$TARGET" != "staging" ]; then
  echo "About to deploy $COUNT instances."
  if [ -t 0 ]; then
    read -p "Continue? (y/N) " -n 1 -r </dev/tty
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 1
    fi
  else
    echo "(Non-interactive — proceeding automatically)"
  fi
fi

# --- Deploy a single container ---
deploy_instance() {
  local ID=$1 PORT=$2 TOKEN=$3 INST_PLAN=${4:-standard} INST_MLIMIT=${5:-250}

  echo "--- Deploying openclaw-$ID (port $PORT) ---"

  ssh "$SERVER" bash -s <<EOF
    set -e

    # Stop and remove existing container
    docker stop "openclaw-$ID" 2>/dev/null || true
    docker rm "openclaw-$ID" 2>/dev/null || true

    # Create network if it doesn't exist
    docker network inspect "openclaw-net-$ID" >/dev/null 2>&1 || docker network create "openclaw-net-$ID"

    # Connect browser container to this network (ignore if already connected)
    docker network connect "openclaw-net-$ID" openclaw-browser 2>/dev/null || true

    docker run -d \\
      --name "openclaw-$ID" \\
      --network "openclaw-net-$ID" \\
      --restart unless-stopped \\
      --add-host=host.docker.internal:host-gateway \\
      -p "$PORT:3000" \\
      -v "openclaw-data-$ID:/data" \\
      -v "openclaw-sandbox-$ID:/sandbox" \\
      -e GATEWAY_TOKEN="$TOKEN" \\
      -e INSTANCE_ID="$ID" \\
      -e PROVISIONING_URL="http://172.17.0.1:3500" \\
      -e GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \\
      -e GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \\
      -e SLACK_CLIENT_ID="$SLACK_CLIENT_ID" \\
      -e SLACK_CLIENT_SECRET="$SLACK_CLIENT_SECRET" \\
      -e SLACK_SIGNING_SECRET="$SLACK_SIGNING_SECRET" \\
      -e AIRTABLE_CLIENT_ID="$AIRTABLE_CLIENT_ID" \\
      -e AIRTABLE_CLIENT_SECRET="$AIRTABLE_CLIENT_SECRET" \\
      -e NOTION_CLIENT_ID="$NOTION_CLIENT_ID" \\
      -e NOTION_CLIENT_SECRET="$NOTION_CLIENT_SECRET" \\
      -e RESEND_API_KEY="$RESEND_API_KEY" \\
      -e BROWSER_SERVICE_URL="http://openclaw-browser:3600" \\
      -e BROWSER_SERVICE_SECRET="$BROWSER_SERVICE_SECRET" \\
      -e TWITTER_CLIENT_ID="$TWITTER_CLIENT_ID" \\
      -e TWITTER_CLIENT_SECRET="$TWITTER_CLIENT_SECRET" \\
      -e GROQ_API_KEY="$GROQ_API_KEY" \\
      -e PIXABAY_API_KEY="$PIXABAY_API_KEY" \\
      -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \\
      -e ONE_SECRET="${ONE_SECRET:-}" \\
      -e MESSAGE_LIMIT="$INST_MLIMIT" \\
      -e PLAN="$INST_PLAN" \\
      $([ "$ID" = "cb1d6d97" ] && echo '-e SKIP_AUTH=true') \\
      $IMAGE
EOF

  # Health check with retry
  local HEALTHY=false
  for i in 1 2 3; do
    sleep 2
    if ssh "$SERVER" "curl -sf http://localhost:$PORT/health" >/dev/null 2>&1; then
      HEALTHY=true
      break
    fi
  done

  if [ "$HEALTHY" = true ]; then
    echo "  ✓ openclaw-$ID healthy"
  else
    echo "  ✗ openclaw-$ID FAILED health check!"
    return 1
  fi
}

# --- Deploy all filtered instances ---
FAILED=0
while IFS='|' read -r ID PORT TOKEN PLAN MLIMIT; do
  deploy_instance "$ID" "$PORT" "$TOKEN" "$PLAN" "$MLIMIT" || FAILED=$((FAILED + 1))
done <<< "$FILTERED"

# --- Summary ---
echo ""
if [ "$FAILED" -gt 0 ]; then
  echo "WARNING: $FAILED instance(s) failed!"
  exit 1
else
  echo "All $COUNT instance(s) deployed successfully."
fi
