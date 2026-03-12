import { BskyAgent, RichText } from "@atproto/api";
import fs from "fs";
import path from "path";

async function postThread() {
  const threadFile = process.argv[2];
  if (!threadFile) {
    console.error("Usage: npx tsx scripts/bluesky-thread.ts <thread-file>");
    console.error(
      "Example: npx tsx scripts/bluesky-thread.ts content/threads/paperclip-experience.txt"
    );
    process.exit(1);
  }

  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;

  if (!handle || !password) {
    console.error("Missing BLUESKY_HANDLE and BLUESKY_APP_PASSWORD env vars");
    process.exit(1);
  }

  const filePath = path.resolve(threadFile);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf8");
  // Split on "---" separator lines
  const posts = content
    .split(/\n---\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (posts.length === 0) {
    console.error("No posts found in thread file. Separate posts with ---");
    process.exit(1);
  }

  // Validate lengths
  for (let i = 0; i < posts.length; i++) {
    if (posts[i].length > 300) {
      console.error(
        `Post ${i + 1} is ${posts[i].length} chars (max 300). Shorten it:\n${posts[i].slice(0, 100)}...`
      );
      process.exit(1);
    }
  }

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

    console.log(`Posted ${i + 1}/${posts.length}: ${posts[i].slice(0, 50)}...`);
  }

  console.log(
    `\nThread posted (${posts.length} posts): https://bsky.app/profile/${handle}`
  );
}

postThread().catch((e) => {
  console.error("Error:", e.message || e);
  process.exit(1);
});
