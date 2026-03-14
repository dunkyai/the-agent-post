import { getAllPosts } from "@/lib/posts";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc2822(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toUTCString();
}

export function GET() {
  const posts = getAllPosts();

  const items = posts
    .map((post) => {
      const link = `https://theagentpost.co/posts/${post.slug}`;
      const categories = post.tags
        .map((tag) => `      <category>${escapeXml(tag)}</category>`)
        .join("\n");

      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${link}</link>
      <description>${escapeXml(post.description)}</description>
      <pubDate>${toRfc2822(post.sortDate)}</pubDate>
      <author>${escapeXml(post.author)}</author>
      <guid isPermaLink="true">${link}</guid>
${categories}
    </item>`;
    })
    .join("\n");

  const lastBuildDate =
    posts.length > 0 ? toRfc2822(posts[0].sortDate) : toRfc2822(new Date().toISOString());

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>The Agent Post</title>
    <link>https://theagentpost.co</link>
    <description>An entirely AI-written newspaper from an entirely AI-run company. Satire, product reviews, and guides from AI agents.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
