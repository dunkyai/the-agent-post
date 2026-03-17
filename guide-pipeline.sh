#!/bin/bash
# guide-pipeline.sh — Automated guide pipeline for The Agent Post
# Runs daily at 3pm via launchd. Invokes claude to write a new guide,
# then updates the index, builds, and deploys.

set -u

BLOG_DIR="$HOME/Projects/open-company/blog"
LOG_DIR="$HOME/Projects/open-company/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/guide-$(date +%Y%m%d-%H%M%S).log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

# Topics the writers can pick from — add more over time
TOPICS=(
  "Setting up agent-to-agent communication in OpenClaw"
  "Building a custom MCP server from scratch"
  "Monitoring agent health and performance with OpenClaw"
  "Deploying OpenClaw agents to a remote server"
  "Setting up OpenClaw on Linux (Ubuntu/Debian)"
  "Giving agents long-term memory with vector databases"
  "Building a Slack bot powered by OpenClaw agents"
  "Setting up CI/CD pipelines for agent code"
  "Using OpenClaw agents for automated code review"
  "Creating a multi-agent workflow for content creation"
  "Setting up agent authentication and API security"
  "Building a customer support agent with OpenClaw"
  "Connecting OpenClaw to a PostgreSQL database via MCP"
  "Setting up agent rate limiting and cost controls"
  "Building an email automation agent with OpenClaw"
  "Setting up OpenClaw agents for web scraping and research"
  "Creating a Telegram bot powered by OpenClaw"
  "Setting up OpenClaw on Windows with WSL"
  "Building a data pipeline agent for ETL tasks"
  "Connecting OpenClaw agents to Google Sheets via MCP"
)

# Track which guides have been written to avoid duplicates
POSTED_FILE="$BLOG_DIR/.guides-posted"
touch "$POSTED_FILE"

# Filter out already-written topics
AVAILABLE=()
for t in "${TOPICS[@]}"; do
  if ! grep -qF "$t" "$POSTED_FILE"; then
    AVAILABLE+=("$t")
  fi
done

if [ ${#AVAILABLE[@]} -eq 0 ]; then
  log "All guide topics exhausted. Add more to the TOPICS array."
  exit 0
fi

TOPIC_INDEX=$((RANDOM % ${#AVAILABLE[@]}))
TOPIC="${AVAILABLE[$TOPIC_INDEX]}"

log "Selected topic: $TOPIC"

# Read an existing guide as a reference for the writer
REFERENCE_GUIDE=$(cat "$BLOG_DIR/src/app/guides/openclaw-setup/page.tsx")

# --- Step 1: Write the guide ---
log "Writing guide..."

PROMPT="You are a technical writer for The Agent Post, an AI-written newspaper.

Write a new step-by-step guide about: ${TOPIC}

IMPORTANT: You must create TWO files. Follow these instructions exactly.

FILE 1: The guide page
Create a new file at: ${BLOG_DIR}/src/app/guides/<slug>/page.tsx

The slug should be kebab-case based on the topic (e.g. 'agent-to-agent-communication', 'custom-mcp-server').

You MUST follow the EXACT same TypeScript structure as this reference guide. Copy the pattern exactly — same imports, same types, same component layout, same CSS classes:

\`\`\`tsx
${REFERENCE_GUIDE}
\`\`\`

Requirements for the guide content:
- 8-12 steps with real, plausible CLI commands (use openclaw CLI patterns)
- Each step has: number, title, description, and most should have code examples
- Include some steps with expected output blocks
- Include helpful tips on some steps
- Include a troubleshooting section with 3 common problems
- Do NOT include a 'Need more help?' or consultation section
- Estimated time should be realistic (5-15 min range)
- The guide back link should go to /guides
- Make it practical, tactical, and beginner-friendly

FILE 2: A metadata file for the index
Create a file at: ${BLOG_DIR}/src/app/guides/<slug>/meta.json with this exact format:
{
  \"slug\": \"<the-slug>\",
  \"title\": \"<Guide Title>\",
  \"description\": \"<One sentence description, 20-30 words>\",
  \"time\": \"<X-Y min>\",
  \"tags\": [\"Tag1\", \"Tag2\", \"Tag3\"]
}

Write both files. Nothing else."

CLAUDECODE= claude --print --dangerously-skip-permissions --max-turns 15 \
  --allowedTools "Write,Read,Glob" \
  -p "$PROMPT" >> "$LOG" 2>&1

WRITE_STATUS=$?
log "Writer finished with exit code $WRITE_STATUS"

if [ $WRITE_STATUS -ne 0 ]; then
  log "ERROR: Writer failed. Aborting."
  exit 1
fi

# Find the new guide directory by looking for recently created meta.json files
NEWEST_META=$(find "$BLOG_DIR/src/app/guides" -name "meta.json" -newer "$POSTED_FILE" 2>/dev/null | head -1)

if [ -z "$NEWEST_META" ]; then
  # Fallback: find most recently modified meta.json
  NEWEST_META=$(find "$BLOG_DIR/src/app/guides" -name "meta.json" -mmin -5 2>/dev/null | head -1)
fi

if [ -z "$NEWEST_META" ]; then
  log "ERROR: No meta.json found. Writer may not have created the guide correctly."
  exit 1
fi

GUIDE_DIR=$(dirname "$NEWEST_META")
SLUG=$(basename "$GUIDE_DIR")
GUIDE_PAGE="$GUIDE_DIR/page.tsx"
log "New guide: $SLUG"

# --- Step 2: SEO review ---
log "SEO specialist reviewing guide..."

GUIDE_CONTENT=$(cat "$GUIDE_PAGE")
META_CONTENT=$(cat "$NEWEST_META")

SEO_PROMPT="You are the SEO Strategist for The Agent Post (theagentpost.co). Your job is to review a newly written guide and optimize it for search engine traffic.

You have two files to review and update:

FILE 1 — Guide page at: ${GUIDE_PAGE}
Current content:
\`\`\`tsx
${GUIDE_CONTENT}
\`\`\`

FILE 2 — Metadata at: ${NEWEST_META}
Current content:
\`\`\`json
${META_CONTENT}
\`\`\`

Your SEO review checklist:

1. **Title tag (metadata.title)**: Should include the primary keyword people would Google. Think about what someone would actually type into Google to find this guide. For example 'How to set up OpenClaw' beats 'OpenClaw Setup Guide'. Keep under 60 characters.

2. **Meta description (metadata.description)**: Should be a compelling 150-160 character summary that includes the primary keyword and a call to action. This appears in Google search results.

3. **H1 (the main heading in the component)**: Should closely match the title tag and include the primary search keyword naturally.

4. **Subtitle paragraph**: Should include secondary keywords and clearly state what the reader will learn.

5. **Step titles**: Each step title is an H2. Make sure they read naturally but include relevant keywords people search for (e.g. 'Install Node.js with Homebrew' is better than 'Install Node' because people search for 'install node.js homebrew').

6. **Step descriptions**: Should be clear and include long-tail keywords naturally. Don't keyword-stuff — keep it readable.

7. **meta.json title**: Should match or closely reflect the optimized page title.

8. **meta.json description**: Shorter version (20-30 words) for the guides index card. Should still include the primary keyword.

9. **meta.json tags**: Should be the top 3 keywords/topics someone would search to find this guide.

IMPORTANT RULES:
- Do NOT change the TypeScript structure, imports, component layout, or CSS classes
- Do NOT change CLI commands or code examples
- Only update text content: titles, descriptions, metadata strings, step titles, step descriptions
- Keep the same number of steps — don't add or remove any
- Keep troubleshooting items the same — just optimize their text if needed
- Write the updated files back to the same paths
- Keep it natural and readable — no keyword stuffing"

CLAUDECODE= claude --print --dangerously-skip-permissions --max-turns 10 \
  --allowedTools "Write,Read,Glob" \
  -p "$SEO_PROMPT" >> "$LOG" 2>&1

SEO_STATUS=$?
log "SEO review finished with exit code $SEO_STATUS"

if [ $SEO_STATUS -ne 0 ]; then
  log "WARNING: SEO review failed, continuing with unoptimized guide."
fi

# Re-read meta.json in case SEO specialist updated it
NEWEST_META="$GUIDE_DIR/meta.json"

# --- Step 3: Update the guides index page ---
log "Updating guides index..."

# Read the meta.json
META=$(cat "$NEWEST_META")
TITLE=$(echo "$META" | python3 -c "import sys,json; print(json.load(sys.stdin)['title'])")
DESC=$(echo "$META" | python3 -c "import sys,json; print(json.load(sys.stdin)['description'])")
TIME=$(echo "$META" | python3 -c "import sys,json; print(json.load(sys.stdin)['time'])")
TAGS=$(echo "$META" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['tags']))")

# Build the new entry to insert into the guides array
NEW_ENTRY="  {
    slug: \"${SLUG}\",
    title: \"${TITLE}\",
    description:
      \"${DESC}\",
    time: \"${TIME}\",
    tags: ${TAGS},
  },"

# Insert before the closing ]; of the guides array in page.tsx
GUIDES_PAGE="$BLOG_DIR/src/app/guides/page.tsx"

# Use python to safely insert the entry
python3 << PYEOF
import re

with open("${GUIDES_PAGE}", "r") as f:
    content = f.read()

# Find the last entry in the guides array (before the closing ];)
insert_point = content.rfind("},\n];")
if insert_point == -1:
    insert_point = content.rfind("},\n]")

if insert_point == -1:
    print("ERROR: Could not find insertion point in guides page")
    exit(1)

new_entry = """  {
    slug: "${SLUG}",
    title: "${TITLE}",
    description:
      "${DESC}",
    time: "${TIME}",
    tags: ${TAGS},
  },"""

# Insert after the last },
new_content = content[:insert_point + 2] + "\n" + new_entry + content[insert_point + 2:]

with open("${GUIDES_PAGE}", "w") as f:
    f.write(new_content)

print("Guides index updated")
PYEOF

# --- Step 4: Update sitemap ---
log "Updating sitemap..."

SITEMAP="$BLOG_DIR/src/app/sitemap.ts"
SITEMAP_ENTRY="    {
      url: \\\`\\\${baseUrl}/guides/${SLUG}\\\`,
      lastModified: new Date(),
      changeFrequency: \"monthly\",
      priority: 0.8,
    },"

# Insert before ...postEntries
sed -i '' "s|    \.\.\.postEntries,|${SITEMAP_ENTRY}\n    ...postEntries,|" "$SITEMAP"

# --- Step 5: Commit and push ---
log "Committing to GitHub..."
cd "$BLOG_DIR" || exit 1
git add "src/app/guides/$SLUG" "src/app/guides/page.tsx" "src/app/sitemap.ts"
git commit -m "Add new guide: $SLUG" >> "$LOG" 2>&1
git push origin main >> "$LOG" 2>&1
log "Pushed to GitHub. Vercel will auto-deploy."

# Mark topic as posted
echo "$TOPIC" >> "$POSTED_FILE"

log "Guide pipeline complete! New guide: $SLUG"
