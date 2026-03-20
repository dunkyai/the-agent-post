import fs from "fs";
import path from "path";
import matter from "gray-matter";
import readingTime from "reading-time";

const postsDirectory = path.join(process.cwd(), "content/posts");

const PEN_NAMES = [
  "Clix-9",
  "Bytewise",
  "Promptia",
  "NeuralNed",
  "Tokk-3",
  "Synthia",
  "Bleep",
  "AgentZero",
];

function pickPenName(slug: string): string {
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PEN_NAMES[hash % PEN_NAMES.length];
}

export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  date: string;
  sortDate: string;
  author: string;
  tags: string[];
  readingTime: string;
}

export interface Post extends PostMeta {
  content: string;
}

export function getAllPosts(): PostMeta[] {
  if (!fs.existsSync(postsDirectory)) return [];

  const files = fs.readdirSync(postsDirectory).filter((f) => f.endsWith(".md"));

  const posts = files.map((filename) => {
    const slug = filename.replace(/\.md$/, "");
    const fullPath = path.join(postsDirectory, filename);
    const fileContents = fs.readFileSync(fullPath, "utf8");
    const { data, content } = matter(fileContents);
    return {
      slug,
      title: data.title || slug,
      description: data.description || "",
      date: data.date
        ? new Date(data.date).toISOString().split("T")[0]
        : "",
      sortDate: data.date || "",
      author: data.author || pickPenName(slug),
      tags: (data.tags || []).slice(0, 4),
      readingTime: readingTime(content).text,
    };
  });

  return posts.sort(
    (a, b) =>
      new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime()
  );
}

export function getAllTags(): { tag: string; count: number }[] {
  const posts = getAllPosts();
  const tagCounts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) {
      const key = tag.toLowerCase();
      tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
    }
  }
  // Use the original casing from the first occurrence
  const tagMap = new Map<string, string>();
  for (const post of posts) {
    for (const tag of post.tags) {
      const key = tag.toLowerCase();
      if (!tagMap.has(key)) tagMap.set(key, tag);
    }
  }
  return Array.from(tagCounts.entries())
    .map(([key, count]) => ({ tag: tagMap.get(key) || key, count }))
    .sort((a, b) => b.count - a.count);
}

export function getPostsByTag(tag: string): PostMeta[] {
  const posts = getAllPosts();
  const lower = tag.toLowerCase();
  return posts.filter((p) => p.tags.some((t) => t.toLowerCase() === lower));
}

export function getRelatedPosts(slug: string, tags: string[], limit = 4): PostMeta[] {
  const posts = getAllPosts().filter((p) => p.slug !== slug);
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const scored = posts.map((p) => ({
    post: p,
    overlap: p.tags.filter((t) => tagSet.has(t.toLowerCase())).length,
  }));
  return scored
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || new Date(b.post.sortDate).getTime() - new Date(a.post.sortDate).getTime())
    .slice(0, limit)
    .map((s) => s.post);
}

export function getPostBySlug(slug: string): Post | null {
  const fullPath = path.join(postsDirectory, `${slug}.md`);
  if (!fs.existsSync(fullPath)) return null;

  const fileContents = fs.readFileSync(fullPath, "utf8");
  const { data, content } = matter(fileContents);

  return {
    slug,
    title: data.title || slug,
    description: data.description || "",
    date: data.date
      ? new Date(data.date).toISOString().split("T")[0]
      : "",
    sortDate: data.date || "",
    author: data.author || pickPenName(slug),
    tags: (data.tags || []).slice(0, 4),
    readingTime: readingTime(content).text,
    content,
  };
}
