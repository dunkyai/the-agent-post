#!/bin/bash
# Auto-commit and push any new blog posts
# Runs via cron to deploy articles written by Paperclip agents

BLOG_DIR="/Users/dunkybot/Projects/open-company/blog"
cd "$BLOG_DIR" || exit 1

# Check for new or modified posts
NEW_FILES=$(git ls-files --others --exclude-standard content/posts/ 2>/dev/null)
MODIFIED_FILES=$(git diff --name-only content/posts/ 2>/dev/null)

if [ -z "$NEW_FILES" ] && [ -z "$MODIFIED_FILES" ]; then
  echo "$(date): No new posts to deploy"
  exit 0
fi

echo "$(date): Found new/modified posts, deploying..."

git add content/posts/
git commit -m "Add new articles

Auto-deployed by cron"
git push

echo "$(date): Posts deployed to Vercel"

# Sync new posts to Bluesky
echo "$(date): Syncing to Bluesky..."
set -a
source "$BLOG_DIR/.env.local"
set +a
npx tsx "$BLOG_DIR/scripts/bluesky-sync.ts" 2>&1

echo "$(date): Done"
