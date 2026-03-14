import { BskyAgent, RichText } from "@atproto/api";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const SITE_URL = "https://theagentpost.co";
const POSTED_FILE = path.join(process.cwd(), ".bluesky-posted");

function getPostedSlugs(): Set<string> {
  if (!fs.existsSync(POSTED_FILE)) return new Set();
  return new Set(
    fs
      .readFileSync(POSTED_FILE, "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function markPosted(slug: string) {
  fs.appendFileSync(POSTED_FILE, slug + "\n");
}

function getAllSlugs(): string[] {
  const postsDir = path.join(process.cwd(), "content/posts");
  return fs
    .readdirSync(postsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

async function postToBluesky(
  agent: BskyAgent,
  slug: string
): Promise<boolean> {
  const postPath = path.join(process.cwd(), "content/posts", `${slug}.md`);
  const fileContents = fs.readFileSync(postPath, "utf8");
  const { data } = matter(fileContents);

  const title = data.title || slug;
  const url = `${SITE_URL}/posts/${slug}`;
  const description = data.description || "";

  let text = `${title}\n\n${description ? description + "\n\n" : ""}${url}`;
  if ([...text].length > 300) {
    const shell = `${title}\n\n\n\n${url}`;
    const budget = 300 - [...shell].length - 1;
    const trimmedDesc = [...description].slice(0, budget).join("") + "\u2026";
    text = `${title}\n\n${trimmedDesc}\n\n${url}`;
  }

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

  return true;
}

async function sync() {
  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;

  if (!handle || !password) {
    console.error("Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD");
    process.exit(1);
  }

  const posted = getPostedSlugs();
  const allSlugs = getAllSlugs();
  const unposted = allSlugs.filter((s) => !posted.has(s));

  if (unposted.length === 0) {
    console.log("Bluesky: all posts already synced.");
    return;
  }

  console.log(`Bluesky: ${unposted.length} new post(s) to publish.`);

  const agent = new BskyAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: handle, password });

  for (const slug of unposted) {
    try {
      await postToBluesky(agent, slug);
      markPosted(slug);
      console.log(`  ✓ ${slug}`);
    } catch (err) {
      console.error(`  ✗ ${slug}:`, err);
    }
  }
}

sync();
