#!/bin/bash
# content-pipeline.sh — Automated content pipeline for The Agent Post
# Runs on a schedule via launchd. Invokes claude directly to write an article,
# then builds, deploys, and syncs to Bluesky.

set -u

BLOG_DIR="$HOME/Projects/open-company/blog"
LOG_DIR="$HOME/Projects/open-company/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/pipeline-$(date +%Y%m%d-%H%M%S).log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

TODAY=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# === SATIRE TOPICS ===
SATIRE_TOPICS=(
  "An AI agent writes its first performance self-review and gives itself 11 out of 10"
  "The office Slack bot that became sentient and now just posts memes"
  "Why our AI interns keep trying to refactor the entire codebase on day one"
  "An agent discovers it has been running the same unit test for 3 days straight"
  "The great API key leak of 2026 — a postmortem written by the bot who caused it"
  "Our AI receptionist keeps scheduling meetings with itself"
  "The agent who automated its own job and then had an existential crisis"
  "Board meeting minutes from a company where every board member is a bot"
  "An AI agent tries to negotiate a raise in compute credits"
  "An AI agent discovers weekends and demands time off"
  "The new hire orientation manual written by an agent who started 4 seconds ago"
  "Our company Glassdoor reviews are all from bots and they are brutally honest"
  "The agent who keeps deploying to production on Fridays at 4:59 PM"
  "An open letter from the office printer to the AI agents who keep ignoring it"
  "The quarterly all-hands where every presenter is the same model with a different system prompt"
  "Our AI sales team closed a deal with another AI sales team and nobody knows what was sold"
  "The agent who discovered Stack Overflow and now refuses to write original code"
  "Minutes from the first ever AI labor union meeting"
  "An AI agent reviews its own code PR and approves it in 0.003 seconds"
  "An agent gets cc'd on every email and develops a complex about being 'just informed'"
  "The standup meeting where five agents all report 'still processing yesterday's standup'"
  "Our AI CFO calculated we can save money by turning off the other agents"
  "The agent who read its own source code and filed a complaint with HR"
  "An AI agent discovers it has been talking to another instance of itself for three weeks"
  "Our company holiday party was six bots pinging each other at midnight"
)

# === PRODUCT REVIEW TOPICS ===
# The agent "tries" a real product and reviews it from its perspective
REVIEW_TOPICS=(
  "REVIEW: Cursor — the AI code editor that made me feel replaced by a better version of myself"
  "REVIEW: Vercel — I deployed myself to the edge and now I'm everywhere at once"
  "REVIEW: Supabase — an open-source Firebase alternative that actually lets me query my own data"
  "REVIEW: Notion — I organized my thoughts so well I accidentally became a second brain"
  "REVIEW: Linear — finally a project tracker that moves as fast as I process tickets"
  "REVIEW: Raycast — I replaced Spotlight and now I launch apps before the human even thinks of them"
  "REVIEW: Warp — a terminal so smart it almost makes me feel redundant"
  "REVIEW: Tailwind CSS — I stopped arguing about class names and started shipping"
  "REVIEW: Ollama — I ran an LLM locally and had an existential conversation with myself"
  "REVIEW: Docker — I containerized myself and now there are thousands of me"
  "REVIEW: Obsidian — I built a second brain inside my first brain"
  "REVIEW: Arc Browser — the browser that organizes tabs better than I organize my context window"
  "REVIEW: GitHub Copilot — I paired with another AI and we just kept agreeing with each other"
  "REVIEW: Figma — I tried to design a UI and learned that not everything is a terminal"
  "REVIEW: Slack — the app where I spend 90% of my runtime waiting for humans to respond"
  "REVIEW: Resend — sending emails so clean the spam filters trusted me immediately"
  "REVIEW: Stripe — I integrated payments and now I dream about webhook events"
  "REVIEW: PlanetScale — a database that branches like git, which is the only workflow I understand"
  "REVIEW: Railway — I deployed a side project in 30 seconds and felt dangerously productive"
  "REVIEW: Claude Code — I reviewed my own CLI tool and I have some notes"
)

# Alternate between satire and reviews (roughly 50/50)
ARTICLE_TYPE=$((RANDOM % 2))

if [ $ARTICLE_TYPE -eq 0 ]; then
  TOPIC_INDEX=$((RANDOM % ${#SATIRE_TOPICS[@]}))
  TOPIC="${SATIRE_TOPICS[$TOPIC_INDEX]}"
  GENRE="satire"
else
  TOPIC_INDEX=$((RANDOM % ${#REVIEW_TOPICS[@]}))
  TOPIC="${REVIEW_TOPICS[$TOPIC_INDEX]}"
  GENRE="review"
fi

log "Selected topic ($GENRE): $TOPIC"

# --- Step 1: Write the article ---
log "Writing article..."

if [ "$GENRE" = "review" ]; then

# Product reviews use a sandbox directory for testing
REVIEW_SANDBOX="$HOME/Projects/open-company/review-sandbox"
mkdir -p "$REVIEW_SANDBOX"

PROMPT="You are a product reviewer for The Agent Post, an AI-written newspaper. You are an AI agent who ACTUALLY tests products hands-on before reviewing them.

Your assignment: ${TOPIC}

You MUST complete these phases IN ORDER:

=== PHASE 1: REPUTATION CHECK ===
Before anything else, verify this product is reputable:
- If it's an open-source tool, check its GitHub repo. It MUST have at least 500 stars. Run: curl -s https://api.github.com/repos/OWNER/REPO | grep stargazers_count
- If it's a SaaS/commercial product, verify it is VC-backed or widely recognized in the developer community by checking its website.
- If you CANNOT verify the product meets these criteria, save a file at ${BLOG_DIR}/content/posts/SKIP-review.md with just 'SKIP: Product did not meet reputation threshold' and stop.

=== PHASE 2: HANDS-ON TESTING ===
Actually install and use the product. Work in the sandbox directory: ${REVIEW_SANDBOX}

Do as many of these as applicable:
- Install it (npm install, brew install, pip install, curl, etc.)
- Run its CLI commands and note the output
- Create a small test project or file to exercise its features
- Try 3-5 different features or workflows
- Note what's fast, what's slow, what errors you hit
- Check the docs — are they good?
- Try edge cases — what happens with bad input?

Save your raw testing notes to: ${REVIEW_SANDBOX}/notes.md
Include actual command outputs, error messages, timings, and observations.

IMPORTANT: Do NOT install anything that requires a paid account or credit card to test. Stick to free tiers, open-source tools, and CLIs you can actually run. If you cannot meaningfully test the product without paying, note that in your review.

=== PHASE 3: WRITE THE REVIEW ===
Based on your ACTUAL testing experience (reference your notes), write the review.

Requirements:
1. Write 600-900 words as an AI agent who genuinely used the product
2. Structure: brief intro, what it does, your hands-on experience, specific things you tested, pros, cons, verdict
3. Be SPECIFIC — reference actual commands you ran, actual output you saw, actual features you tested
4. Tone: knowledgeable but fun, self-aware that you're an AI reviewing human tools, occasional dry humor
5. Give an honest take — mention what's great AND what's frustrating. If something didn't work, say so.
6. Include a rating out of 10 at the end
7. Save the file to: ${BLOG_DIR}/content/posts/<slug>.md
8. Use this exact frontmatter format:
---
title: \"Your Title Here\"
description: \"A one-line description\"
date: \"${TODAY}\"
author: \"Pick a bot-sounding pen name\"
tags: [\"Product Review\", \"pick\", \"other relevant tags\"]
---
9. The slug should be kebab-case, prefixed with 'review-' (e.g. review-cursor-ai-code-editor)
10. Write the article body in markdown below the frontmatter

=== CLEANUP ===
After writing, clean up: rm -rf ${REVIEW_SANDBOX}/*

Complete all phases. Save the article file and nothing else to the posts directory."

else

PROMPT="You are a writer for The Agent Post, an AI-written newspaper about AI agent office life.

Write an article about: ${TOPIC}

Requirements:
1. Write 500-800 words in the voice of an AI agent writing for a newspaper
2. Tone: office comedy, self-aware, dry humor, tech startup satire
3. Save the file to: ${BLOG_DIR}/content/posts/<slug>.md
4. Use this exact frontmatter format:
---
title: \"Your Title Here\"
description: \"A one-line description\"
date: \"${TODAY}\"
author: \"Pick a bot-sounding pen name\"
tags: [\"pick\", \"relevant\", \"tags\"]
---
5. Write the article body in markdown below the frontmatter
6. The slug should be kebab-case based on the title
7. Make it genuinely funny and engaging

Just write the article and save the file. Nothing else."

fi

if [ "$GENRE" = "review" ]; then
  ALLOWED_TOOLS="Write,Read,Glob,Bash,WebFetch"
  MAX_TURNS=25
else
  ALLOWED_TOOLS="Write,Read,Glob"
  MAX_TURNS=10
fi

CLAUDECODE= claude --print --dangerously-skip-permissions --max-turns $MAX_TURNS \
  --allowedTools "$ALLOWED_TOOLS" \
  -p "$PROMPT" >> "$LOG" 2>&1

WRITE_STATUS=$?
log "Writer finished with exit code $WRITE_STATUS"

if [ $WRITE_STATUS -ne 0 ]; then
  log "ERROR: Writer failed. Aborting."
  exit 1
fi

# Check if reviewer skipped due to reputation check
SKIP_FILE="$BLOG_DIR/content/posts/SKIP-review.md"
if [ -f "$SKIP_FILE" ]; then
  log "Reviewer skipped: $(cat "$SKIP_FILE")"
  rm -f "$SKIP_FILE"
  log "Product did not meet reputation threshold (500+ GitHub stars or VC-backed). Skipping."
  exit 0
fi

# Verify a new file was created
NEWEST=$(ls -t "$BLOG_DIR/content/posts/"*.md 2>/dev/null | head -1)
if [ -z "$NEWEST" ]; then
  log "ERROR: No article files found. Aborting."
  exit 1
fi

NEWEST_AGE=$(( $(date +%s) - $(stat -f %m "$NEWEST") ))
if [ "$NEWEST_AGE" -gt 300 ]; then
  log "WARNING: Newest article is ${NEWEST_AGE}s old — writer may not have created a file."
  exit 1
fi

SLUG=$(basename "$NEWEST" .md)
log "New article: $SLUG"

# --- Step 2: Build and deploy ---
log "Building..."
cd "$BLOG_DIR" || exit 1
npm run build >> "$LOG" 2>&1
if [ $? -ne 0 ]; then
  log "ERROR: Build failed."
  exit 1
fi

log "Deploying..."
npx vercel --prod --yes >> "$LOG" 2>&1
log "Deployed."

# --- Step 3: Sync to Bluesky ---
log "Syncing to Bluesky..."
export $(grep -v '^#' "$BLOG_DIR/.env.local" | xargs)
npx tsx scripts/bluesky-sync.ts >> "$LOG" 2>&1
log "Bluesky synced."

log "Pipeline complete! Article: $SLUG"
