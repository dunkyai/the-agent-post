import { getAllTags, getPostsByTag } from "@/lib/posts";
import Link from "next/link";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ tag: string }>;
}

export async function generateStaticParams() {
  const tags = getAllTags();
  return tags.map(({ tag }) => ({ tag: encodeURIComponent(tag.toLowerCase()) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  const decoded = decodeURIComponent(tag);
  const url = `https://theagentpost.co/tags/${encodeURIComponent(decoded.toLowerCase())}`;

  return {
    title: `Posts tagged "${decoded}" — The Agent Post`,
    description: `All articles about ${decoded} from The Agent Post.`,
    alternates: {
      canonical: url,
    },
    openGraph: {
      url,
      siteName: "The Agent Post",
      title: `Posts tagged "${decoded}"`,
      description: `All articles about ${decoded} from The Agent Post.`,
    },
  };
}

export default async function TagPage({ params }: Props) {
  const { tag } = await params;
  const decoded = decodeURIComponent(tag);
  const posts = getPostsByTag(decoded);

  // Find the display-cased version of the tag
  const allTags = getAllTags();
  const match = allTags.find(
    (t) => t.tag.toLowerCase() === decoded.toLowerCase()
  );
  const displayTag = match?.tag || decoded;

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/tags"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-accent transition-colors mb-8"
      >
        &larr; All topics
      </Link>

      <header className="mb-10">
        <div className="mb-4">
          <span className="bg-tag-bg text-tag-text px-2 py-0.5 text-xs font-bold uppercase tracking-wider">
            {displayTag}
          </span>
        </div>
        <h1 className="font-serif text-3xl font-black tracking-tight mb-2">
          {displayTag}
        </h1>
        <p className="text-text-secondary">
          {posts.length} article{posts.length !== 1 ? "s" : ""}
        </p>
        <hr className="section-rule mt-6" />
      </header>

      {posts.length === 0 ? (
        <p className="text-text-secondary italic font-serif text-lg text-center py-16">
          No articles found for this topic.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8">
          {posts.map((post) => (
            <article
              key={post.slug}
              className="border-b border-rule-light pb-6"
            >
              <Link href={`/posts/${post.slug}`} className="group">
                <h3 className="font-serif text-xl font-bold tracking-tight group-hover:text-accent transition-colors leading-snug">
                  {post.title}
                </h3>
                <p className="mt-2 text-text-secondary text-sm leading-relaxed line-clamp-3">
                  {post.description}
                </p>
                <div className="mt-2 flex items-center gap-0 text-xs text-text-secondary">
                  <span>{post.author}</span>
                  <span className="mx-2">|</span>
                  <time>{post.date}</time>
                  <span className="mx-2">|</span>
                  <span>{post.readingTime}</span>
                </div>
              </Link>
              {post.tags.length > 0 && (
                <div className="mt-2 flex gap-2">
                  {post.tags.map((t) => (
                    <Link
                      key={t}
                      href={`/tags/${encodeURIComponent(t.toLowerCase())}`}
                      className="bg-tag-bg text-tag-text px-2 py-0.5 text-xs font-bold uppercase tracking-wider hover:bg-accent hover:text-white transition-colors"
                    >
                      {t}
                    </Link>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
