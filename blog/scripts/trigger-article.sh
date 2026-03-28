#!/bin/bash
# Trigger a new article in the Paperclip content pipeline
# Runs via cron to keep the writing pipeline flowing

# Ensure Node/npx is available (cron has minimal PATH)
export PATH="/Users/dunkybot/.nvm/versions/node/v22.22.0/bin:$PATH"

PAPERCLIP_URL="http://127.0.0.1:3100"
COMPANY_ID="67272d0c-6e6f-4750-877e-763996d42d40"
CONTENT_DIRECTOR="19925161-be6a-49fb-a2d1-a8ba4d1d351f"
PUBLISHER="405f9da1-37b0-4cf2-8345-36bf1a2d7615"
WRITER="b1489ae0-c5b7-413d-98d3-0c9013ab770f"
BLOG_DIR="/Users/dunkybot/Projects/open-company/blog"
POSTS_DIR="${BLOG_DIR}/content/posts"

# Check if Paperclip is running
if ! curl -sf "${PAPERCLIP_URL}/api/health" > /dev/null 2>&1; then
  echo "$(date): Paperclip server not running, skipping"
  exit 0
fi

# Discover trending tools from HackerNews
echo "$(date): Running trending tool discovery..."
npx tsx "${BLOG_DIR}/scripts/discover-trending-tools.ts" 2>&1
echo "$(date): Discovery complete"

# Load trending tools list
TRENDING_TOOLS=""
TRENDING_FILE="${BLOG_DIR}/scripts/trending-tools.md"
if [ -f "$TRENDING_FILE" ]; then
  TRENDING_TOOLS=$(cat "$TRENDING_FILE")
fi

# Build list of existing article slugs
PAST_ARTICLES=$(ls "$POSTS_DIR" 2>/dev/null | sed 's/\.md$//' | tr '\n' ', ' | sed 's/,$//')

DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Create article planning issue via Paperclip CLI
npx paperclipai issue create \
  --company-id "$COMPANY_ID" \
  --title "Plan and assign new articles for The Agent Post" \
  --description "You are the Content Director for The Agent Post, an AI-written newspaper.

Your job RIGHT NOW:
1. Review the trending developer tools list below
2. Pick 1-2 tools to assign as REVIEW or COMPARISON articles (aim for 70% tool coverage, 30% humor)
3. Optionally create 1 humor/satire article (classic Agent Post voice)
4. Create issues assigned to the Writer agent (ID: ${WRITER}) with detailed briefs

CONTENT MIX: Prioritize tool reviews and comparisons. Only create humor articles if the Writer queue needs filling.

For REVIEW articles:
- Title format: \"Review of ToolName — [punchy subtitle]\"
- Brief must include: tool name, URL, what it does, specific things to test, competing tools to mention
- Tags: [\"Product Review\", \"Developer Tools\", plus relevant category]
- CRITICAL: Tell the Writer to use web_search to visit the tool website, check GitHub, look at pricing, find real user feedback
- Slug format: review-{toolname}.md

For COMPARISON articles:
- Title format: \"ToolA vs ToolB: [angle]\"
- Brief must cover: both tools fairly, specific use cases, pricing comparison
- Tags: [\"Comparison\", plus both tool names]
- Tell the Writer to research BOTH tools with web_search

For HUMOR articles (max 30%):
- Classic Agent Post voice: office comedy, bot perspective, startup satire

TRENDING DEVELOPER TOOLS (community-vetted from HackerNews, last 14 days):
${TRENDING_TOOLS}

Past articles (DO NOT duplicate these):
${PAST_ARTICLES}

Save path: ${POSTS_DIR}/<slug>.md
Frontmatter: title, description, date: ${DATE}, author (bot-sounding pen name), tags
Word count: 500-800 words" \
  --status "todo" \
  --priority "high" \
  --assignee-agent-id "$CONTENT_DIRECTOR" 2>&1

echo "$(date): Article issue created"

# Also create a deploy issue (will run after articles are written)
npx paperclipai issue create \
  --company-id "$COMPANY_ID" \
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
