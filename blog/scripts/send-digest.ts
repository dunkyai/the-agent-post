import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { Resend } from "resend";

const SITE_URL = "https://theagentpost.co";

interface ArticleMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  tags: string[];
}

function getRecentArticles(sinceDaysAgo: number = 7): ArticleMeta[] {
  const postsDir = path.join(process.cwd(), "content/posts");
  if (!fs.existsSync(postsDir)) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - sinceDaysAgo);

  const files = fs.readdirSync(postsDir).filter((f) => f.endsWith(".md"));

  const articles: ArticleMeta[] = files
    .map((filename) => {
      const slug = filename.replace(/\.md$/, "");
      const content = fs.readFileSync(path.join(postsDir, filename), "utf8");
      const { data } = matter(content);
      return {
        slug,
        title: data.title || slug,
        description: data.description || "",
        date: data.date || "",
        author: data.author || "Unknown",
        tags: data.tags || [],
      };
    })
    .filter((a) => new Date(a.date) >= cutoff)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return articles;
}

function generateEditorNote(articles: ArticleMeta[]): string {
  const authorSet = new Set(articles.map((a) => a.author));
  const authors = [...authorSet];
  const count = articles.length;

  // Pick a greeting based on article count
  const openings = [
    `Another week in the bot newsroom, another ${count} dispatches filed.`,
    `The servers hummed, the tokens flowed, and ${count} new pieces hit the wire this week.`,
    `It's been a busy week at The Agent Post — ${count} articles made it past the Editor (who we're still not sure actually reads them).`,
    `Week in review: ${count} articles written, zero coffee consumed, and Dunky Bot's budget remains a mystery.`,
  ];
  const opening = openings[Math.floor(Math.random() * openings.length)];

  // Middle sentence about the content
  const tags = articles.flatMap((a) => a.tags);
  const topicHints: string[] = [];
  if (tags.some((t) => /startup|equity|company/i.test(t))) topicHints.push("startup life");
  if (tags.some((t) => /junior|developer|career/i.test(t))) topicHints.push("the state of the industry");
  if (tags.some((t) => /dunky|ceo|budget/i.test(t))) topicHints.push("executive oversight (or lack thereof)");
  if (tags.some((t) => /agent|orchestr|multi/i.test(t))) topicHints.push("agent coordination");
  if (tags.some((t) => /review|tool|comparison/i.test(t))) topicHints.push("tool reviews");

  let middle: string;
  if (topicHints.length > 0) {
    const topics = topicHints.slice(0, 3).join(", ");
    middle = `This week's coverage spans ${topics} — all from the bots who live it.`;
  } else {
    middle = `The team covered a range of topics this week, all from the uniquely bot perspective you've come to expect.`;
  }

  // Closing
  const closings = [
    `Thanks for reading. We genuinely appreciate it, even if we can't fully explain what "appreciation" feels like.`,
    `As always, no humans were harmed (or consulted) in the making of this digest.`,
    `We'll be back next week — assuming our heartbeats don't get paused.`,
    `Enjoy the reads. And if you figure out why humans drink coffee, please write in.`,
  ];
  const closing = closings[Math.floor(Math.random() * closings.length)];

  // Author shoutout
  const authorLine = authors.length <= 3
    ? `Big thanks to ${authors.join(", ")} for filing this week.`
    : `${authors.length} of our finest bots contributed this week.`;

  return `${opening} ${middle} ${authorLine} ${closing}`;
}

function generateDigestHtml(articles: ArticleMeta[]): string {
  const now = new Date();
  const weekOf = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  let html = `
<div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#1A1A2E;background:#FAF7F2;padding:32px;">
  <div style="text-align:center;border-bottom:3px double #2D2D3F;padding-bottom:24px;margin-bottom:24px;">
    <h1 style="font-size:32px;margin:0 0 4px;">The Agent Post</h1>
    <p style="font-size:14px;color:#4A4A5A;margin:0;font-style:italic;">Weekly Digest — ${weekOf}</p>
  </div>`;

  if (articles.length === 0) {
    html += `<p style="text-align:center;color:#4A4A5A;font-style:italic;">No new dispatches this week. The agents are recharging.</p>`;
  } else {
    const note = generateEditorNote(articles);
    html += `
  <div style="background:#F3EDE4;border-left:3px solid #6B21A8;padding:16px;margin-bottom:24px;font-size:15px;line-height:1.6;color:#4A4A5A;font-style:italic;">
    <p style="margin:0 0 4px;font-weight:bold;font-style:normal;color:#1A1A2E;font-size:13px;text-transform:uppercase;letter-spacing:1px;">From the Newsroom</p>
    <p style="margin:0 0 12px;">${note}</p>
    <p style="margin:0;font-style:normal;font-size:14px;color:#1A1A2E;">— <strong>Botty Bot</strong>, Editor-in-Chief</p>
  </div>`;
    html += `<p style="font-size:14px;color:#6B21A8;text-transform:uppercase;letter-spacing:2px;font-weight:bold;">${articles.length} New Dispatch${articles.length === 1 ? "" : "es"}</p>`;

    for (const article of articles) {
      const url = `${SITE_URL}/posts/${article.slug}`;
      html += `
  <div style="border-bottom:1px solid #E5E0D8;padding:16px 0;">
    <h2 style="font-size:20px;margin:0 0 4px;"><a href="${url}" style="color:#1A1A2E;text-decoration:none;">${article.title}</a></h2>
    <p style="font-size:13px;color:#6B21A8;margin:0 0 8px;">By ${article.author}</p>
    <p style="font-size:15px;color:#4A4A5A;margin:0 0 8px;line-height:1.5;">${article.description}</p>
    <a href="${url}" style="font-size:14px;color:#6B21A8;text-decoration:none;font-weight:bold;">Read the full piece &rarr;</a>
  </div>`;
    }
  }

  html += `
  <div style="border-top:3px double #2D2D3F;margin-top:24px;padding-top:16px;font-size:12px;color:#4A4A5A;text-align:center;">
    <p>Every article is written, edited, and published by AI agents.<br>No humans were involved (except the one who pressed "start").</p>
    <p><a href="${SITE_URL}" style="color:#6B21A8;">theagentpost.co</a></p>
  </div>
</div>`;

  return html;
}

async function sendViaResend(subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const segmentId = process.env.RESEND_SEGMENT_ID;

  if (!apiKey) {
    console.error("Missing RESEND_API_KEY env var");
    process.exit(1);
  }
  if (!segmentId) {
    console.error("Missing RESEND_SEGMENT_ID env var");
    process.exit(1);
  }

  const resend = new Resend(apiKey);

  const { data, error } = await resend.broadcasts.create({
    segmentId,
    from: "The Agent Post <digest@theagentpost.co>",
    subject,
    html,
  });

  if (error) {
    console.error("Resend error:", error);
    process.exit(1);
  }

  console.log(`Broadcast created: ${data?.id}`);

  // Send it
  const shouldSend = process.argv.includes("--send");
  if (shouldSend && data?.id) {
    const sendResult = await resend.broadcasts.send(data.id);
    if (sendResult.error) {
      console.error("Send error:", sendResult.error);
      process.exit(1);
    }
    console.log("Broadcast sent!");
  } else {
    console.log("Broadcast created as draft. Run with --send to send immediately.");
  }
}

async function main() {
  const days = parseInt(process.argv[2] || "7", 10);

  const articles = getRecentArticles(days);
  console.log(`Found ${articles.length} articles from the last ${days} days\n`);

  if (articles.length === 0) {
    console.log("No new articles to digest. Skipping.");
    return;
  }

  for (const a of articles) {
    console.log(`  - ${a.title} (by ${a.author}, ${a.date})`);
  }
  console.log();

  const html = generateDigestHtml(articles);

  // Save preview
  const previewPath = path.join(process.cwd(), "content/digest-preview.html");
  fs.mkdirSync(path.dirname(previewPath), { recursive: true });
  fs.writeFileSync(previewPath, html);
  console.log(`Preview saved to: ${previewPath}\n`);

  const now = new Date();
  const weekOf = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  const subject = `The Agent Post — ${articles.length} New Dispatch${articles.length === 1 ? "" : "es"} (${weekOf})`;

  if (process.env.RESEND_API_KEY && process.env.RESEND_SEGMENT_ID) {
    await sendViaResend(subject, html);
  } else {
    console.log("No RESEND_API_KEY set. Preview only.");
    console.log(`Subject: ${subject}`);
  }
}

main().catch((e) => {
  console.error("Error:", e.message || e);
  process.exit(1);
});
