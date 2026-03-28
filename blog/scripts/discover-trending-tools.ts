#!/usr/bin/env npx tsx
/**
 * Discover trending developer tools from HackerNews.
 * Queries HN Algolia API, deduplicates against existing blog posts,
 * and outputs a curated markdown file for the Content Director.
 *
 * Usage: npx tsx scripts/discover-trending-tools.ts
 * Output: scripts/trending-tools.md
 */

import fs from "fs";
import path from "path";

// --- Config ---

const POSTS_DIR = "/Users/dunkybot/Projects/open-company/blog/content/posts";
const OUTPUT_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), "trending-tools.md");
const HN_API = "https://hn.algolia.com/api/v1";
const DAYS_BACK = 14;
const HITS_PER_QUERY = 20;

// --- Types ---

interface HNHit {
  objectID: string;
  title: string;
  url: string | null;
  points: number;
  num_comments: number;
  created_at: string;
}

interface HNResponse {
  hits: HNHit[];
}

interface Tool {
  name: string;
  hnTitle: string;
  url: string;
  hnUrl: string;
  points: number;
  comments: number;
  category: string;
  postedAt: string;
  angle: "review" | "comparison";
}

// --- Search queries ---

const QUERIES = [
  { query: "Show HN", tags: "show_hn", minPoints: 30 },
  { query: "AI agent tool", tags: "story", minPoints: 15 },
  { query: "AI agent framework", tags: "story", minPoints: 10 },
  { query: "developer tool", tags: "story", minPoints: 20 },
  { query: "coding tool", tags: "story", minPoints: 15 },
  { query: "CLI tool", tags: "story", minPoints: 15 },
  { query: "open source alternative", tags: "story", minPoints: 20 },
  { query: "MCP server", tags: "story", minPoints: 10 },
  { query: "AI coding", tags: "story", minPoints: 20 },
  { query: "agent framework", tags: "story", minPoints: 10 },
];

// --- Category rules ---

const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(agent|mcp|llm|ai assistant|copilot|prompt|rag|langchain|langgraph|crew.?ai)\b/i, category: "AI/Agent Tools" },
  { pattern: /\b(ide|editor|code editor|vim|neovim|vscode|cursor|windsurf|zed)\b/i, category: "Code Editors" },
  { pattern: /\b(terminal|cli|shell|command.line|tui)\b/i, category: "CLI/Terminal" },
  { pattern: /\b(database|postgres|sqlite|mongo|redis|supabase|planetscale|drizzle|prisma)\b/i, category: "Databases" },
  { pattern: /\b(deploy|docker|kubernetes|k8s|infra|cloud|hosting|serverless|vercel|railway|fly\.io)\b/i, category: "Infrastructure" },
  { pattern: /\b(api|sdk|framework|library|runtime|bun|deno)\b/i, category: "Frameworks/Libraries" },
  { pattern: /\b(monitor|observ|log|debug|test|ci\/cd|lint|format)\b/i, category: "DevOps/Testing" },
  { pattern: /\b(design|figma|ui|ux|frontend|css|tailwind|component)\b/i, category: "Design/Frontend" },
  { pattern: /\b(note|knowledge|docs|wiki|writing|obsidian|notion)\b/i, category: "Productivity" },
];

// Words that aren't tool names (common English words that pass capitalization filters)
const SKIP_NAMES = new Set([
  "a", "an", "the", "i", "we", "my", "our", "your", "what", "how", "why",
  "when", "where", "who", "this", "that", "open", "new", "show", "three",
  "four", "five", "built", "made", "just", "plain", "simple", "small",
  "fast", "free", "robust", "minimalist", "modern", "lightweight",
]);

// Domains that are never tools
const SKIP_DOMAINS = new Set([
  "twitter.com", "x.com", "youtube.com", "youtu.be", "reddit.com",
  "medium.com", "substack.com", "nytimes.com", "wsj.com", "bbc.com",
  "theverge.com", "techcrunch.com", "arstechnica.com", "wired.com",
  "bloomberg.com", "reuters.com", "wikipedia.org", "arxiv.org",
]);

// --- Functions ---

function cutoffTimestamp(): number {
  return Math.floor((Date.now() - DAYS_BACK * 86400 * 1000) / 1000);
}

async function searchHN(query: string, tags: string, minPoints: number): Promise<HNHit[]> {
  const cutoff = cutoffTimestamp();
  const params = new URLSearchParams({
    query,
    tags,
    numericFilters: `points>${minPoints},created_at_i>${cutoff}`,
    hitsPerPage: String(HITS_PER_QUERY),
  });

  const url = `${HN_API}/search_by_date?${params}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as HNResponse;
    return data.hits || [];
  } catch {
    return [];
  }
}

function extractToolName(title: string): string | null {
  // "Show HN: ToolName – description" or "Show HN: ToolName - description"
  const showHnMatch = title.match(/^(?:Show|Launch) HN:\s*([^–—\-:(]+)/i);
  if (showHnMatch) {
    const name = showHnMatch[1].trim();
    // If the extracted name is too long (a sentence, not a tool name), take first 1-3 words
    if (name.split(/\s+/).length > 4) {
      // Try to find just the tool name (capitalized words at the start)
      const shortMatch = name.match(/^([A-Z][A-Za-z0-9.]+(?:\s[A-Z][A-Za-z0-9.]+){0,2})/);
      if (shortMatch) return shortMatch[1];
      return null; // Too sentence-like, skip
    }
    return name;
  }

  // "ToolName: description"
  const colonMatch = title.match(/^([A-Z][A-Za-z0-9.]+(?:\s[A-Z][A-Za-z0-9.]+){0,2}):\s/);
  if (colonMatch) return colonMatch[1].trim();

  // "ToolName – description"
  const dashMatch = title.match(/^([A-Z][A-Za-z0-9.]+(?:\s[A-Z][A-Za-z0-9.]+){0,2})\s*[–—-]\s/);
  if (dashMatch) return dashMatch[1].trim();

  return null;
}

function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function categorize(title: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(title)) return rule.category;
  }
  return "Developer Tools";
}

function getAlreadyReviewedTools(): Set<string> {
  const reviewed = new Set<string>();

  // Hardcoded known reviewed tools (from existing content/posts/ filenames)
  const KNOWN_REVIEWED = [
    "cursor", "docker", "figma", "linear", "notion", "obsidian", "ollama",
    "planetscale", "slack", "stripe", "supabase", "warp", "claude",
    "openclaw", "paperclip", "vercel", "jira", "google",
  ];
  for (const t of KNOWN_REVIEWED) reviewed.add(t);

  try {
    const files = fs.readdirSync(POSTS_DIR);
    for (const file of files) {
      const slug = file.replace(/\.md$/, "");
      // Extract tool name from review slugs: review-cursor-ai-code-editor → cursor
      if (slug.startsWith("review-")) {
        const toolPart = slug.replace("review-", "").split("-")[0];
        if (toolPart) reviewed.add(toolPart.toLowerCase());
      }
      // Extract tool names from comparison slugs: toolA-vs-toolB
      const vsMatch = slug.match(/^(.+?)-vs-(.+?)(?:-|$)/);
      if (vsMatch) {
        reviewed.add(vsMatch[1].toLowerCase());
        reviewed.add(vsMatch[2].toLowerCase());
      }
    }
  } catch { /* directory doesn't exist */ }
  return reviewed;
}

function processHits(allHits: HNHit[], reviewed: Set<string>): Tool[] {
  const seen = new Map<string, Tool>(); // toolName lowercase → Tool

  for (const hit of allHits) {
    if (!hit.url) continue;

    const domain = getDomain(hit.url);
    if (!domain || SKIP_DOMAINS.has(domain)) continue;

    const name = extractToolName(hit.title);
    if (!name) continue;

    const nameLower = name.toLowerCase().split(/\s+/)[0]; // first word for matching
    if (reviewed.has(nameLower)) continue;

    // Skip common English words that aren't tool names
    if (SKIP_NAMES.has(nameLower)) continue;
    // Skip names that start with "I " (sentences like "I built...")
    if (name.startsWith("I ")) continue;

    const existing = seen.get(nameLower);
    if (existing && existing.points >= hit.points) continue;

    seen.set(nameLower, {
      name,
      hnTitle: hit.title,
      url: hit.url,
      hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      points: hit.points,
      comments: hit.num_comments,
      category: categorize(hit.title + " " + name),
      postedAt: hit.created_at,
      angle: "review",
    });
  }

  // Suggest comparisons when 2+ tools in same category
  const byCategory = new Map<string, Tool[]>();
  for (const tool of seen.values()) {
    const list = byCategory.get(tool.category) || [];
    list.push(tool);
    byCategory.set(tool.category, list);
  }
  for (const tools of byCategory.values()) {
    if (tools.length >= 2) {
      // Mark the second-highest-points tool as comparison candidate
      tools.sort((a, b) => b.points - a.points);
      if (tools[1]) tools[1].angle = "comparison";
    }
  }

  // Sort by points descending
  return Array.from(seen.values()).sort((a, b) => b.points - a.points);
}

function generateMarkdown(tools: Tool[], reviewed: Set<string>): string {
  const now = new Date().toISOString();
  const lines: string[] = [
    `# Trending Developer Tools`,
    `Generated: ${now}`,
    `Source: HackerNews (last ${DAYS_BACK} days, community-vetted)`,
    ``,
  ];

  if (tools.length === 0) {
    lines.push("No new trending tools found this period. Use web_search to find recent launches.");
    lines.push("");
    lines.push(`## Already Reviewed (skip these)`);
    lines.push(Array.from(reviewed).sort().join(", "));
    return lines.join("\n");
  }

  // Group by category
  const byCategory = new Map<string, Tool[]>();
  for (const tool of tools) {
    const list = byCategory.get(tool.category) || [];
    list.push(tool);
    byCategory.set(tool.category, list);
  }

  for (const [category, catTools] of byCategory) {
    lines.push(`## ${category}`);
    lines.push("");

    for (const tool of catTools) {
      lines.push(`### ${tool.name}`);
      lines.push(`- **URL**: ${tool.url}`);
      lines.push(`- **HN Discussion**: ${tool.hnUrl} (${tool.points} points, ${tool.comments} comments)`);
      lines.push(`- **Suggested angle**: ${tool.angle === "comparison" ? "Comparison (another tool in this category is also trending)" : "Review"}`);
      lines.push(`- **Posted**: ${tool.postedAt.split("T")[0]}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(`## Already Reviewed (skip these)`);
  lines.push(Array.from(reviewed).sort().join(", "));
  lines.push("");

  return lines.join("\n");
}

// --- Main ---

async function main() {
  console.log(`Discovering trending tools from HackerNews (last ${DAYS_BACK} days)...`);

  // Run all queries in parallel
  const results = await Promise.all(
    QUERIES.map((q) => searchHN(q.query, q.tags, q.minPoints))
  );
  const allHits = results.flat();
  console.log(`Fetched ${allHits.length} total HN hits across ${QUERIES.length} queries`);

  const reviewed = getAlreadyReviewedTools();
  console.log(`Found ${reviewed.size} already-reviewed tools: ${Array.from(reviewed).sort().join(", ")}`);

  const tools = processHits(allHits, reviewed);
  console.log(`${tools.length} new trending tools after dedup and filtering`);

  const markdown = generateMarkdown(tools, reviewed);
  fs.writeFileSync(OUTPUT_FILE, markdown, "utf-8");
  console.log(`Output written to ${OUTPUT_FILE}`);

  // Print summary
  for (const tool of tools.slice(0, 10)) {
    console.log(`  ${tool.points}pts | ${tool.category} | ${tool.name} (${tool.angle})`);
  }
}

main().catch((err) => {
  console.error("Discovery failed:", err);
  process.exit(1);
});
