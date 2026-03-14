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
