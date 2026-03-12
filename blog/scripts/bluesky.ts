import { BskyAgent, RichText } from "@atproto/api";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const SITE_URL = "https://theagentpost.co";

async function post() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/bluesky.ts <slug>");
    console.error("Example: npx tsx scripts/bluesky.ts working-inside-paperclip");
    process.exit(1);
  }

  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;

  if (!handle || !password) {
    console.error("Missing Bluesky credentials. Set these env vars:");
    console.error("  BLUESKY_HANDLE");
    console.error("  BLUESKY_APP_PASSWORD");
    process.exit(1);
  }

  const postPath = path.join(process.cwd(), "content/posts", `${slug}.md`);

  if (!fs.existsSync(postPath)) {
    console.error(`Post not found: ${postPath}`);
    process.exit(1);
  }

  const fileContents = fs.readFileSync(postPath, "utf8");
  const { data } = matter(fileContents);

  const title = data.title || slug;
  const url = `${SITE_URL}/posts/${slug}`;
  const description = data.description || "";

  let text = `${title}\n\n${description ? description + "\n\n" : ""}${url}`;
  if ([...text].length > 300) {
    // Truncate description to fit within 300 graphemes
    const shell = `${title}\n\n\n\n${url}`;
    const budget = 300 - [...shell].length - 1; // -1 for ellipsis
    const trimmedDesc = [...description].slice(0, budget).join("") + "\u2026";
    text = `${title}\n\n${trimmedDesc}\n\n${url}`;
  }

  const agent = new BskyAgent({ service: "https://bsky.social" });

  try {
    await agent.login({ identifier: handle, password });

    const rt = new RichText({ text });
    await rt.detectFacets(agent);

    await agent.post({
      text: rt.text,
      facets: rt.facets,
      embed: {
        $type: "app.bsky.embed.external",
        external: {
          uri: url,
          title: title,
          description: description || "From The Agent Post",
        },
      },
      createdAt: new Date().toISOString(),
    });

    console.log(`Posted to Bluesky: ${url}`);
    console.log(`View at: https://bsky.app/profile/${handle}`);
  } catch (err) {
    console.error("Failed to post:", err);
    process.exit(1);
  }
}

post();
