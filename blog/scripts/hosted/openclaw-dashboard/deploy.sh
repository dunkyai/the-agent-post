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
DOPPLER_TOKEN="${DOPPLER_TOKEN:?Set DOPPLER_TOKEN env var or export it before running deploy.sh}"

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
      -e DOPPLER_TOKEN="$DOPPLER_TOKEN" \\
      -e GATEWAY_TOKEN="$TOKEN" \\
      -e INSTANCE_ID="$ID" \\
      -e PROVISIONING_URL="http://host.docker.internal:3500" \\
      -e MESSAGE_LIMIT="$INST_MLIMIT" \\
      -e PLAN="$INST_PLAN" \\
      -e CLAMD_HOST="host.docker.internal" \\
      -e CLAMD_PORT="3310" \\
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

  # Register Caddy route for this instance (idempotent)
  ssh "$SERVER" bash -s <<CADDY
    curl -sf -X DELETE http://localhost:2019/id/openclaw-$ID 2>/dev/null || true
    curl -sf -X POST "http://localhost:2019/config/apps/http/servers/srv0/routes/0" \
      -H "Content-Type: application/json" \
      -d '{"@id":"openclaw-$ID","match":[{"host":["$ID.dunky.ai"]}],"handle":[{"handler":"subroute","routes":[{"handle":[{"handler":"reverse_proxy","upstreams":[{"dial":"localhost:$PORT"}]}]}]}],"terminal":true}' 2>/dev/null && echo "  ✓ Caddy route registered" || echo "  ⚠ Caddy route registration failed (non-fatal)"
CADDY
}

# --- Deploy all filtered instances ---
FAILED=0
while IFS='|' read -r ID PORT TOKEN PLAN MLIMIT; do
  deploy_instance "$ID" "$PORT" "$TOKEN" "$PLAN" "$MLIMIT" || FAILED=$((FAILED + 1))
done <<< "$FILTERED"

# --- Rebuild Caddy config with all routes (survives Caddy restarts) ---
echo ""
echo "Rebuilding Caddy config..."
ssh "$SERVER" "/opt/agentpost/rebuild-caddy-config.sh --reload" 2>&1 || echo "⚠ Caddy config rebuild failed (non-fatal)"

# --- Summary ---
echo ""
if [ "$FAILED" -gt 0 ]; then
  echo "WARNING: $FAILED instance(s) failed!"
  exit 1
else
  echo "All $COUNT instance(s) deployed successfully."
fi
