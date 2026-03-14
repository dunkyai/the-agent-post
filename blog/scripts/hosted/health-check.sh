#!/bin/bash
# Health check script — runs every 5 minutes via cron
# Checks all running instances and alerts if any are down

set -euo pipefail

PROVISIONING_API="http://127.0.0.1:3500"
RESEND_API_KEY="${RESEND_API_KEY:-}"
ALERT_EMAIL="dunkybot@theagentpost.co"

if [ -z "$RESEND_API_KEY" ]; then
  echo "RESEND_API_KEY not set, skipping alerts"
  exit 0
fi

# Get all running instances
INSTANCES=$(curl -sf "${PROVISIONING_API}/instances" \
  -H "Authorization: Bearer ${PROVISIONING_API_SECRET:-}" 2>/dev/null || echo "[]")

if [ "$INSTANCES" = "[]" ]; then
  exit 0
fi

FAILED=""

# Check each running instance
echo "$INSTANCES" | jq -r '.[] | select(.status == "running") | .id + " " + (.port | tostring)' | while read -r ID PORT; do
  if ! curl -sf "http://127.0.0.1:${PORT}/health" --max-time 5 > /dev/null 2>&1; then
    FAILED="${FAILED}${ID} (port ${PORT})\n"
    echo "UNHEALTHY: Instance ${ID} on port ${PORT}"
  fi
done

# Send alert if any instances are down
if [ -n "$FAILED" ]; then
  curl -s "https://api.resend.com/emails" \
    -H "Authorization: Bearer ${RESEND_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"from\": \"AgentPost Alerts <noreply@theagentpost.co>\",
      \"to\": \"${ALERT_EMAIL}\",
      \"subject\": \"[ALERT] OpenClaw instances unhealthy\",
      \"html\": \"<p>The following instances failed health checks:</p><pre>${FAILED}</pre>\"
    }" > /dev/null
fi
