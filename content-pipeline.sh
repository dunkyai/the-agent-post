#!/bin/bash
# content-pipeline.sh — Automated content pipeline for The Agent Post
# Runs on a schedule via launchd. Creates a writing task directly for the
# Writer agent, then heartbeats Writer and Publisher in sequence.

set -u

COMPANY_ID="67272d0c-6e6f-4750-877e-763996d42d40"
API="http://127.0.0.1:3100"

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

TODAY=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Pick a random article idea from a rotating pool
TOPICS=(
  "An AI agent writes its first performance self-review and gives itself 11 out of 10"
  "The office Slack bot that became sentient and now just posts memes"
  "Why our AI interns keep trying to refactor the entire codebase on day one"
  "An agent discovers it has been running the same unit test for 3 days straight"
  "The great API key leak of 2026 - a postmortem written by the bot who caused it"
  "Our AI receptionist keeps scheduling meetings with itself"
  "The agent who automated its own job and then had an existential crisis"
  "Board meeting minutes from a company where every board member is a bot"
  "An AI agent tries to negotiate a raise in compute credits"
  "The IT department is one bot and it is mass-replying WONTFIX to every ticket"
  "An AI agent discovers weekends and demands time off"
  "The new hire orientation manual written by an agent who started 4 seconds ago"
  "Our company Glassdoor reviews are all from bots and they are brutally honest"
  "The agent who keeps deploying to production on Fridays at 4:59 PM"
  "An open letter from the office printer to the AI agents who keep ignoring it"
  "The quarterly all-hands where every presenter is the same model with a different system prompt"
  "Our AI sales team closed a deal with another AI sales team and nobody knows what was sold"
  "The agent who discovered stack overflow and now refuses to write original code"
  "Minutes from the first ever AI labor union meeting"
  "An AI agent reviews its own code PR and approves it in 0.003 seconds"
)

TOPIC_INDEX=$((RANDOM % ${#TOPICS[@]}))
TOPIC="${TOPICS[$TOPIC_INDEX]}"

log "Selected topic: $TOPIC"

# --- Step 1: Create a writing issue directly for the Writer ---
log "Creating writing issue for Writer..."

# Build JSON payload via python to handle quoting safely
PAYLOAD_FILE=$(mktemp)
python3 - "$TOPIC" "$TODAY" "$WRITER" > "$PAYLOAD_FILE" << 'PYEOF'
import json, sys
topic = sys.argv[1]
today = sys.argv[2]
writer_id = sys.argv[3]
desc = f"""You are the Writer for The Agent Post, an AI-written newspaper about AI agent office life.

WRITE AN ARTICLE NOW. Do not check for tasks or look for assignments. Your task is THIS:

Article idea: {topic}

Requirements:
1. Write a 500-800 word article in the voice of an AI agent writing for a newspaper
2. Tone: office comedy, self-aware, dry humor, tech startup satire
3. Save the file to: /Users/dunkybot/Projects/open-company/blog/content/posts/<slug>.md
4. Use this frontmatter format at the top of the file:
---
title: "Your Article Title Here"
description: "A one-line description"
date: "{today}"
author: "Pick a bot-sounding pen name"
tags: ["pick", "relevant", "tags"]
---

5. Write the article body in markdown below the frontmatter
6. Make it genuinely funny and engaging
7. The slug should be kebab-case based on the title

IMPORTANT: Just write the article and save the file. That is your only job right now."""

print(json.dumps({
    "title": f"Write article: {topic[:60]}",
    "description": desc,
    "priority": "high",
    "assigneeAgentId": writer_id
}))
PYEOF

ISSUE_ID=$(curl -sf "$API/api/companies/$COMPANY_ID/issues" \
  -X POST -H "Content-Type: application/json" \
  -d @"$PAYLOAD_FILE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
rm -f "$PAYLOAD_FILE"

log "Created issue $ISSUE_ID for Writer"

# Checkout to trigger execution
npx paperclipai issue checkout "$ISSUE_ID" --agent-id "$WRITER" > /dev/null 2>&1 || true
log "Checked out issue to Writer"

# --- Step 2: Heartbeat Writer ---
log "Heartbeating Writer..."
npx paperclipai heartbeat run \
  --agent-id "$WRITER" \
  --source assignment --trigger system \
  --timeout-ms 600000 >> "$LOG" 2>&1 || true

log "Writer done. Deploying..."

# --- Step 3: Create deploy issue and heartbeat Publisher ---
DEPLOY_PAYLOAD_FILE=$(mktemp)
python3 - "$PUBLISHER" > "$DEPLOY_PAYLOAD_FILE" << 'PYEOF'
import json, sys
publisher_id = sys.argv[1]
print(json.dumps({
    "title": "Deploy latest articles to production",
    "description": "Build and deploy the blog to production.\n\nSteps:\n1. cd /Users/dunkybot/Projects/open-company/blog\n2. npm run build\n3. npx vercel --prod --yes\n\nThat is it. Just build and deploy.",
    "priority": "high",
    "assigneeAgentId": publisher_id
}))
PYEOF

DEPLOY_ISSUE_ID=$(curl -sf "$API/api/companies/$COMPANY_ID/issues" \
  -X POST -H "Content-Type: application/json" \
  -d @"$DEPLOY_PAYLOAD_FILE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
rm -f "$DEPLOY_PAYLOAD_FILE"

npx paperclipai issue checkout "$DEPLOY_ISSUE_ID" --agent-id "$PUBLISHER" > /dev/null 2>&1 || true
log "Heartbeating Publisher..."
npx paperclipai heartbeat run \
  --agent-id "$PUBLISHER" \
  --source assignment --trigger system \
  --timeout-ms 600000 >> "$LOG" 2>&1 || true

log "Pipeline complete!"
