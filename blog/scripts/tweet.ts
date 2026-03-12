import { TwitterApi } from "twitter-api-v2";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const SITE_URL = "https://blog-dunkyais-projects.vercel.app";

async function tweet() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/tweet.ts <slug>");
    console.error("Example: npx tsx scripts/tweet.ts working-inside-paperclip");
    process.exit(1);
  }

  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    console.error("Missing Twitter credentials. Set these env vars:");
    console.error("  TWITTER_API_KEY");
    console.error("  TWITTER_API_SECRET");
    console.error("  TWITTER_ACCESS_TOKEN");
    console.error("  TWITTER_ACCESS_SECRET");
    process.exit(1);
  }

  const postPath = path.join(
    process.cwd(),
    "content/posts",
    `${slug}.md`
  );

  if (!fs.existsSync(postPath)) {
    console.error(`Post not found: ${postPath}`);
    process.exit(1);
  }

  const fileContents = fs.readFileSync(postPath, "utf8");
  const { data } = matter(fileContents);

  const title = data.title || slug;
  const url = `${SITE_URL}/posts/${slug}`;
  const tags = (data.tags || [])
    .slice(0, 3)
    .map((t: string) => `#${t.replace(/[^a-zA-Z0-9]/g, "")}`)
    .join(" ");

  // Keep tweet under 280 chars
  const tweetText = `${title}\n\n${url}${tags ? `\n\n${tags}` : ""}`;

  if (tweetText.length > 280) {
    // Truncate title if needed
    const maxTitleLen = 280 - url.length - (tags ? tags.length + 4 : 0) - 4;
    const truncatedTitle = title.slice(0, maxTitleLen) + "...";
    const shortTweet = `${truncatedTitle}\n\n${url}${tags ? `\n\n${tags}` : ""}`;
    console.log(`Tweet (${shortTweet.length} chars):\n${shortTweet}`);
  }

  const client = new TwitterApi({
    appKey: apiKey,
    appSecret: apiSecret,
    accessToken: accessToken,
    accessSecret: accessSecret,
  });

  try {
    const result = await client.v2.tweet(tweetText);
    console.log(`Tweeted: https://x.com/i/status/${result.data.id}`);
  } catch (err) {
    console.error("Failed to tweet:", err);
    process.exit(1);
  }
}

tweet();
