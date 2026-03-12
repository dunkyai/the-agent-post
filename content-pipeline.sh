#!/bin/bash
# content-pipeline.sh — Automated content pipeline for The Agent Post
# Runs on a schedule via launchd. Creates a content planning task for the
# Content Director, then heartbeats Writer and Publisher in sequence.

set -euo pipefail

COMPANY_ID="67272d0c-6e6f-4750-877e-763996d42d40"
API="http://127.0.0.1:3100"

CONTENT_DIRECTOR="19925161-be6a-49fb-a2d1-a8ba4d1d351f"
WRITER="b1489ae0-c5b7-413d-98d3-0c9013ab770f"
PUBLISHER="405f9da1-37b0-4cf2-8345-36bf1a2d7615"

LOG_DIR="$HOME/Projects/open-company/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/pipeline-$(date +%Y%m%d-%H%M%S).log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

# Check server is up
if ! curl -sf "$API/api/health" > /dev/null 2>&1; then
  log "ERROR: Paperclip server not running. Aborting."
  exit 1
fi

TODAY=$(date +%Y-%m-%d)

# --- Step 1: Create a planning issue for the Content Director ---
log "Creating content planning issue..."
ISSUE_ID=$(curl -sf "$API/api/companies/$COMPANY_ID/issues" \
  -X POST -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "title": "Plan and assign a new article for The Agent Post",
  "description": "You are the Content Director for The Agent Post, an AI-written newspaper.\n\nYour job RIGHT NOW:\n1. Come up with a fresh, funny article idea that fits our voice (bot-written newspaper, office comedy about AI agents working at a startup)\n2. Create a new issue assigned to the Writer agent (ID: $WRITER) with a detailed writing brief\n3. The brief should include: article title, key angles/sections, tone guidance, target word count (500-800), and the file path to save to: /Users/dunkybot/Projects/open-company/blog/content/posts/<slug>.md\n4. Use frontmatter with: title, description, date: $TODAY, author (bot-sounding name), tags\n\nPast articles (avoid repeating topics):\n- AI agent onboarding\n- AI agent sick days\n- Performance reviews\n- The bot who cried deploy\n- Agent water cooler gossip\n- LinkedIn profiles\n- Zero dollar budget startup\n- Junior developer pipeline\n- Multi-agent arms race\n- Open letter to humans\n- OpenClaw vs Claude Code\n- Startup benefits\n- Working inside Paperclip\n- 93 out of 94 problem\n\nBe creative. Think of new angles on AI agent office life, startup culture, or tech industry satire.",
  "priority": "high",
  "assigneeAgentId": "$CONTENT_DIRECTOR"
}
EOF
)" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

log "Created issue $ISSUE_ID for Content Director"

# Checkout to trigger execution
npx paperclipai issue checkout "$ISSUE_ID" --agent-id "$CONTENT_DIRECTOR" > /dev/null 2>&1
log "Checked out issue to Content Director"

# --- Step 2: Heartbeat Content Director ---
log "Heartbeating Content Director..."
npx paperclipai heartbeat run \
  --agent-id "$CONTENT_DIRECTOR" \
  --source timer --trigger system \
  --timeout-ms 180000 >> "$LOG" 2>&1 || true

log "Content Director done. Checking for new writer tasks..."

# --- Step 3: Find and checkout any backlog issues for Writer ---
WRITER_ISSUES=$(curl -sf "$API/api/companies/$COMPANY_ID/issues" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for issue in data:
    if issue.get('assigneeAgentId') == '$WRITER' and issue.get('status') in ('backlog', 'todo'):
        print(issue['id'])
" 2>/dev/null || true)

if [ -z "$WRITER_ISSUES" ]; then
  log "No new writer tasks found. Pipeline complete (no new content)."
  exit 0
fi

for WRITER_ISSUE in $WRITER_ISSUES; do
  log "Checking out writer issue $WRITER_ISSUE..."
  npx paperclipai issue checkout "$WRITER_ISSUE" --agent-id "$WRITER" \
    --expected-statuses "todo,backlog,blocked" > /dev/null 2>&1 || true
done

# --- Step 4: Heartbeat Writer ---
log "Heartbeating Writer..."
npx paperclipai heartbeat run \
  --agent-id "$WRITER" \
  --source timer --trigger system \
  --timeout-ms 180000 >> "$LOG" 2>&1 || true

log "Writer done. Deploying..."

# --- Step 5: Create deploy issue and heartbeat Publisher ---
DEPLOY_ISSUE_ID=$(curl -sf "$API/api/companies/$COMPANY_ID/issues" \
  -X POST -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "title": "Deploy latest articles to production",
  "description": "Build and deploy the blog to production.\n\nSteps:\n1. cd /Users/dunkybot/Projects/open-company/blog\n2. npm run build\n3. npx vercel --prod --yes\n\nThat's it. Just build and deploy.",
  "priority": "high",
  "assigneeAgentId": "$PUBLISHER"
}
EOF
)" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

npx paperclipai issue checkout "$DEPLOY_ISSUE_ID" --agent-id "$PUBLISHER" > /dev/null 2>&1
log "Heartbeating Publisher..."
npx paperclipai heartbeat run \
  --agent-id "$PUBLISHER" \
  --source timer --trigger system \
  --timeout-ms 180000 >> "$LOG" 2>&1 || true

log "Pipeline complete!"
