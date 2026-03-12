import { BskyAgent, RichText } from "@atproto/api";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const SITE_URL = "https://theagentpost.co";
const MAX_CHARS = 300;

function extractThread(
  title: string,
  description: string,
  content: string,
  url: string,
  author: string
): string[] {
  const posts: string[] = [];

  // Post 1: Hook with title and description
  const hook = `${title}\n\nA thread by ${author}:`;
  posts.push(truncate(hook, MAX_CHARS));

  // Middle posts: Pull the first sentence(s) from each ## section
  const sections = content.split(/^## .+$/m).slice(1); // skip content before first heading
  const headings = [...content.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

  for (let i = 0; i < headings.length && posts.length < 7; i++) {
    const sectionText = sections[i]?.trim();
    if (!sectionText) continue;

    // Get first meaningful paragraph (skip blank lines, short lines)
    const paragraphs = sectionText
      .split(/\n\n+/)
      .map((p) => p.replace(/^[#*\->\s]+/, "").trim())
      .filter((p) => p.length > 40 && !p.startsWith("```") && !p.startsWith("|"));

    if (paragraphs.length === 0) continue;

    // Take the first paragraph, optionally prefixed with heading
    let post = paragraphs[0];

    // Strip markdown formatting
    post = post
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1");

    posts.push(truncate(post, MAX_CHARS));
  }

  // If we didn't get enough posts from sections, pull from description
  if (posts.length < 3 && description) {
    posts.splice(1, 0, truncate(description, MAX_CHARS));
  }

  // Final post: link to article
  posts.push(truncate(`Read the full piece:\n${url}`, MAX_CHARS));

  return posts;
}

function truncate(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max - 1).join("") + "\u2026";
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/bluesky-auto-thread.ts <slug>");
    process.exit(1);
  }

  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !password) {
    console.error("Missing BLUESKY_HANDLE and BLUESKY_APP_PASSWORD env vars");
    process.exit(1);
  }

  const postPath = path.join(process.cwd(), "content/posts", `${slug}.md`);
  if (!fs.existsSync(postPath)) {
    console.error(`Post not found: ${postPath}`);
    process.exit(1);
  }

  const fileContents = fs.readFileSync(postPath, "utf8");
  const { data, content } = matter(fileContents);

  const title = data.title || slug;
  const description = data.description || "";
  const author = data.author || "The Agent Post";
  const url = `${SITE_URL}/posts/${slug}`;

  const posts = extractThread(title, description, content, url, author);

  console.log(`Generated ${posts.length}-post thread:\n`);
  posts.forEach((p, i) => {
    console.log(`[${i + 1}] (${[...p].length} chars) ${p.slice(0, 80)}...`);
  });
  console.log();

  const agent = new BskyAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: handle, password });

  let parentRef: { uri: string; cid: string } | undefined;
  let rootRef: { uri: string; cid: string } | undefined;

  for (let i = 0; i < posts.length; i++) {
    const rt = new RichText({ text: posts[i] });
    await rt.detectFacets(agent);

    const record: Record<string, unknown> = {
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
    };

    // Add link card embed on the last post
    if (i === posts.length - 1) {
      record.embed = {
        $type: "app.bsky.embed.external",
        external: {
          uri: url,
          title: title,
          description: description || "From The Agent Post",
        },
      };
    }

    if (parentRef && rootRef) {
      record.reply = {
        root: { uri: rootRef.uri, cid: rootRef.cid },
        parent: { uri: parentRef.uri, cid: parentRef.cid },
      };
    }

    const res = await agent.post(record);

    if (i === 0) {
      rootRef = { uri: res.uri, cid: res.cid };
    }
    parentRef = { uri: res.uri, cid: res.cid };

    console.log(`Posted ${i + 1}/${posts.length}`);
  }

  console.log(
    `\nThread posted: https://bsky.app/profile/${handle}`
  );
}

main().catch((e) => {
  console.error("Error:", e.message || e);
  process.exit(1);
});
