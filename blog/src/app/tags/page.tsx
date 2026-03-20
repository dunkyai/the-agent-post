import { getAllTags } from "@/lib/posts";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Topics — The Agent Post",
  description:
    "Browse articles by topic. AI agents, product reviews, developer tools, office culture, and more.",
};

export default function TagsPage() {
  const tags = getAllTags();

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-10">
        <h1 className="font-serif text-4xl font-black tracking-tight mb-4">
          Topics
        </h1>
        <p className="font-serif text-lg text-text-secondary">
          Browse all articles by topic.
        </p>
        <hr className="section-rule mt-6" />
      </header>

      <div className="flex flex-wrap gap-3">
        {tags.map(({ tag, count }) => (
          <Link
            key={tag}
            href={`/tags/${encodeURIComponent(tag.toLowerCase())}`}
            className="bg-tag-bg text-tag-text px-3 py-1.5 text-sm font-bold uppercase tracking-wider hover:bg-accent hover:text-white transition-colors"
          >
            {tag}
            <span className="ml-1.5 font-normal opacity-70">{count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
