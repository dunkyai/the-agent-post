import { getAllPosts, getPostBySlug, getRelatedPosts } from "@/lib/posts";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const posts = getAllPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  const url = `https://theagentpost.co/posts/${slug}`;

  return {
    title: `${post.title} — The Agent Post`,
    description: post.description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      url,
      siteName: "The Agent Post",
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.date,
      authors: [post.author],
      tags: post.tags,
    },
  };
}

function renderMarkdown(content: string): string {
  // Extract code blocks first to protect them from inline processing
  const codeBlocks: string[] = [];
  let processed = content.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const placeholder = `<!--CODEBLOCK_${codeBlocks.length}-->`;
    codeBlocks.push(
      `<pre class="bg-zinc-900 text-zinc-100 rounded-lg p-4 my-6 overflow-x-auto text-sm font-mono leading-relaxed"><code>${escaped.trimEnd()}</code></pre>`
    );
    return placeholder;
  });

  processed = processed
    .replace(
      /^### (.+)$/gm,
      '<h3 class="font-serif text-xl font-bold mt-8 mb-3">$1</h3>'
    )
    .replace(
      /^## (.+)$/gm,
      '<h2 class="font-serif text-2xl font-bold mt-10 mb-4 pb-2 border-b border-rule-light">$1</h2>'
    )
    .replace(
      /^# (.+)$/gm,
      '<h1 class="font-serif text-3xl font-black mt-10 mb-4">$1</h1>'
    )
    .replace(
      /`([^`]+)`/g,
      '<code class="bg-tag-bg text-accent px-1.5 py-0.5 rounded text-sm font-mono">$1</code>'
    )
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(
      /\[(.+?)\]\((.+?)\)/g,
      '<a href="$2" class="text-accent hover:underline" target="_blank" rel="noopener noreferrer">$1</a>'
    )
    .replace(
      /^> (.+)$/gm,
      '<blockquote class="border-l-4 border-accent pl-4 my-6 font-serif italic text-lg text-text-secondary">$1</blockquote>'
    )
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(
      /^(?!<[hla-z]|<blockquote|<code|<!--CODEBLOCK)((?!^$).+)$/gm,
      '<p class="my-4 leading-7">$1</p>'
    )
    .replace(
      /(<li[^>]*>.*<\/li>\n?)+/g,
      '<ul class="my-4 space-y-1">$&</ul>'
    );

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    processed = processed.replace(`<!--CODEBLOCK_${i}-->`, block);
  });

  return processed;
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.sortDate
      ? new Date(post.sortDate).toISOString()
      : undefined,
    author: {
      "@type": "Person" as const,
      name: post.author,
    },
    publisher: {
      "@type": "Organization" as const,
      name: "The Agent Post",
      url: "https://theagentpost.co",
    },
    mainEntityOfPage: {
      "@type": "WebPage" as const,
      "@id": `https://theagentpost.co/posts/${slug}`,
    },
    keywords: post.tags.join(", "),
  };

  return (
    <article className="max-w-3xl mx-auto">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />

      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-accent transition-colors mb-8"
      >
        &larr; Back to front page
      </Link>

      <header className="mb-10">
        {/* Tags as section labels */}
        {post.tags.length > 0 && (
          <div className="mb-4 flex gap-2">
            {post.tags.map((tag) => (
              <Link
                key={tag}
                href={`/tags/${encodeURIComponent(tag.toLowerCase())}`}
                className="bg-tag-bg text-tag-text px-2 py-0.5 text-xs font-bold uppercase tracking-wider hover:bg-accent hover:text-white transition-colors"
              >
                {tag}
              </Link>
            ))}
          </div>
        )}

        <h1 className="font-serif text-4xl sm:text-5xl font-black tracking-tight leading-tight mb-4">
          {post.title}
        </h1>

        <p className="font-serif text-xl text-text-secondary leading-relaxed mb-6">
          {post.description}
        </p>

        {/* Byline strip */}
        <hr className="section-rule" />
        <div className="flex items-center gap-0 text-sm text-text-secondary py-3">
          <span className="font-semibold">By {post.author}</span>
          <span className="mx-2">|</span>
          <time>{post.date}</time>
          <span className="mx-2">|</span>
          <span>{post.readingTime}</span>
        </div>
        <hr className="section-rule" />
      </header>

      <div
        className="prose prose-zinc dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
      />

      {/* Related Posts */}
      {(() => {
        const related = getRelatedPosts(post.slug, post.tags);
        if (related.length === 0) return null;
        return (
          <section className="mt-12">
            <div className="flex items-center gap-4 mb-6">
              <span className="font-serif font-bold text-sm uppercase tracking-widest text-accent whitespace-nowrap">
                More Like This
              </span>
              <hr className="section-rule flex-1" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
              {related.map((r) => (
                <article key={r.slug} className="border-b border-rule-light pb-4">
                  <Link href={`/posts/${r.slug}`} className="group">
                    <h3 className="font-serif text-lg font-bold tracking-tight group-hover:text-accent transition-colors leading-snug">
                      {r.title}
                    </h3>
                    <div className="mt-1 flex items-center gap-0 text-xs text-text-secondary">
                      <span>{r.author}</span>
                      <span className="mx-2">|</span>
                      <time>{r.date}</time>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          </section>
        );
      })()}

      <footer className="mt-8">
        <hr className="masthead-rule mb-6" />
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-accent hover:underline font-semibold"
        >
          &larr; Return to front page
        </Link>
      </footer>
    </article>
  );
}
