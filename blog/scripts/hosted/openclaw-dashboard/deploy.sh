#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/containers.env"

TARGET="${1:-staging}"
IMAGE="openclaw-dashboard"

# --- Build ---
echo "Building $IMAGE (linux/amd64)..."
docker buildx build --platform linux/amd64 -t "$IMAGE" --load "$SCRIPT_DIR"

# --- Transfer ---
echo "Transferring image to $SERVER..."
docker save "$IMAGE" | gzip | ssh "$SERVER" 'docker load'

# --- Helper to run a container ---
run_container() {
  local ID=$1 PORT=$2 TOKEN=$3

  ssh "$SERVER" bash -s <<EOF
    docker stop "openclaw-$ID" 2>/dev/null || true
    docker rm "openclaw-$ID" 2>/dev/null || true

    # Create network if it doesn't exist
    docker network inspect "openclaw-net-$ID" >/dev/null 2>&1 || docker network create "openclaw-net-$ID"

    docker run -d \\
      --name "openclaw-$ID" \\
      --network "openclaw-net-$ID" \\
      -v "openclaw-data-$ID:/data" \\
      -v "openclaw-sandbox-$ID:/sandbox" \\
      -e DB_PATH=/data/openclaw.db \\
      -e PORT=3000 \\
      -e GATEWAY_TOKEN="$TOKEN" \\
      -e INSTANCE_ID="$ID" \\
      -e PROVISIONING_URL=http://host.docker.internal:3500 \\
      -e GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \\
      -e GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \\
      -e SLACK_CLIENT_ID="$SLACK_CLIENT_ID" \\
      -e AIRTABLE_CLIENT_ID="$AIRTABLE_CLIENT_ID" \\
      -e AIRTABLE_CLIENT_SECRET="$AIRTABLE_CLIENT_SECRET" \\
      -e NOTION_CLIENT_ID="$NOTION_CLIENT_ID" \\
      -e NOTION_CLIENT_SECRET="$NOTION_CLIENT_SECRET" \\
      -e RESEND_API_KEY="$RESEND_API_KEY" \\
      -e PROVISIONING_API_SECRET="$PROVISIONING_API_SECRET" \\
      -p "$PORT:3000" \\
      --add-host=host.docker.internal:host-gateway \\
      --restart unless-stopped \\
      $IMAGE
EOF
  echo "  $ID -> port $PORT"
}

# --- Health check ---
health_check() {
  local PORT=$1
  sleep 2
  local STATUS
  STATUS=$(ssh "$SERVER" "curl -sf http://localhost:$PORT/health | head -c 30" 2>/dev/null || echo "FAIL")
  if echo "$STATUS" | grep -q '"ok"'; then
    echo "  Health: OK"
  else
    echo "  Health: FAILED ($STATUS)"
    return 1
  fi
}

# --- Deploy ---
if [ "$TARGET" = "staging" ]; then
  echo ""
  echo "Deploying to STAGING..."
  run_container "$STAGING_ID" "$STAGING_PORT" "$STAGING_TOKEN"
  health_check "$STAGING_PORT"
  echo ""
  echo "Staging live at https://staging.agents.theagentpost.co"

elif [ "$TARGET" = "prod" ]; then
  echo ""
  echo "Deploying to PRODUCTION (${#PROD_INSTANCES[@]} instances)..."
  read -p "Are you sure? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi

  FAILED=0
  for ENTRY in "${PROD_INSTANCES[@]}"; do
    IFS=':' read -r ID PORT TOKEN <<< "$ENTRY"
    run_container "$ID" "$PORT" "$TOKEN"
    health_check "$PORT" || FAILED=$((FAILED + 1))
  done

  echo ""
  if [ "$FAILED" -gt 0 ]; then
    echo "WARNING: $FAILED instance(s) failed health check!"
    exit 1
  else
    echo "All ${#PROD_INSTANCES[@]} production instances deployed successfully."
  fi

else
  echo "Usage: $0 [staging|prod]"
  exit 1
fi
