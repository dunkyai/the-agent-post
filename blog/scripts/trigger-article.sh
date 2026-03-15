#!/bin/bash
# Trigger a new article in the Paperclip content pipeline
# Runs via cron to keep the writing pipeline flowing

PAPERCLIP_URL="http://127.0.0.1:3100"
COMPANY_ID="67272d0c-6e6f-4750-877e-763996d42d40"
CONTENT_DIRECTOR="19925161-be6a-49fb-a2d1-a8ba4d1d351f"
PUBLISHER="405f9da1-37b0-4cf2-8345-36bf1a2d7615"
WRITER="b1489ae0-c5b7-413d-98d3-0c9013ab770f"
POSTS_DIR="/Users/dunkybot/Projects/open-company/blog/content/posts"

# Check if Paperclip is running
if ! curl -sf "${PAPERCLIP_URL}/api/health" > /dev/null 2>&1; then
  echo "$(date): Paperclip server not running, skipping"
  exit 0
fi

# Build list of existing article slugs
PAST_ARTICLES=$(ls "$POSTS_DIR" 2>/dev/null | sed 's/\.md$//' | tr '\n' ', ' | sed 's/,$//')

DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Create article planning issue via Paperclip CLI
npx paperclipai issue create \
  --title "Plan and assign a new article for The Agent Post" \
  --description "You are the Content Director for The Agent Post, an AI-written newspaper.

Your job RIGHT NOW:
1. Come up with a fresh, funny article idea that fits our voice (bot-written newspaper, office comedy about AI agents working at a startup)
2. Create a new issue assigned to the Writer agent (ID: ${WRITER}) with a detailed writing brief
3. The brief should include: article title, key angles/sections, tone guidance, target word count (500-800), and the file path to save to: ${POSTS_DIR}/<slug>.md
4. Use frontmatter with: title, description, date: ${DATE}, author (bot-sounding name), tags

Past articles (avoid repeating topics):
${PAST_ARTICLES}

Be creative. Think of new angles on AI agent office life, startup culture, or tech industry satire." \
  --status "todo" \
  --priority "high" \
  --assignee-agent-id "$CONTENT_DIRECTOR" 2>&1

echo "$(date): Article issue created"

# Also create a deploy issue (will run after articles are written)
npx paperclipai issue create \
  --title "Deploy latest articles to production" \
  --description "Build and deploy the blog to production.

Steps:
1. cd /Users/dunkybot/Projects/open-company/blog
2. git add content/posts/
3. git commit -m \"Add new articles\"
4. git push
5. Wait 60 seconds for Vercel to auto-deploy

That is it. Just commit, push, and let Vercel handle the deployment." \
  --status "todo" \
  --priority "medium" \
  --assignee-agent-id "$PUBLISHER" 2>&1

echo "$(date): Deploy issue created"
