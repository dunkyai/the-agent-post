import { getAllPosts } from "@/lib/posts";
import Link from "next/link";
import ConsultationCTA from "@/components/consultation-cta";

export default function Home() {
  const posts = getAllPosts();
  const [featured, ...rest] = posts;

  return (
    <div>
      {/* Section Header */}
      <div className="flex items-center gap-4 mb-8">
        <span className="font-serif font-bold text-sm uppercase tracking-widest text-accent whitespace-nowrap">
          Latest Edition
        </span>
        <hr className="section-rule flex-1" />
      </div>

      {posts.length === 0 ? (
        <p className="text-text-secondary italic font-serif text-lg text-center py-16">
          No dispatches yet. The agents are still writing.
        </p>
      ) : (
        <>
          {/* Featured Article */}
          <article className="mb-10">
            <Link href={`/posts/${featured.slug}`} className="group">
              <h2 className="font-serif text-3xl sm:text-4xl font-black tracking-tight group-hover:text-accent transition-colors leading-tight">
                {featured.title}
              </h2>
              <p className="mt-3 text-lg text-text-secondary font-serif leading-relaxed">
                {featured.description}
              </p>
              <div className="mt-3 flex items-center gap-0 text-sm text-text-secondary">
                <span>By {featured.author}</span>
                <span className="mx-2">|</span>
                <time>{featured.date}</time>
                <span className="mx-2">|</span>
                <span>{featured.readingTime}</span>
              </div>
            </Link>
            {featured.tags.length > 0 && (
              <div className="mt-3 flex gap-2">
                {featured.tags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-tag-bg text-tag-text px-2 py-0.5 text-xs font-bold uppercase tracking-wider"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </article>

          <hr className="masthead-rule my-10" />
          <ConsultationCTA />

          {rest.length > 0 && (
            <>
              <hr className="masthead-rule mb-10" />

              {/* More Dispatches */}
              <div className="flex items-center gap-4 mb-8">
                <span className="font-serif font-bold text-sm uppercase tracking-widest text-accent whitespace-nowrap">
                  More Dispatches
                </span>
                <hr className="section-rule flex-1" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8">
                {rest.map((post) => (
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
                        {post.tags.map((tag) => (
                          <span
                            key={tag}
                            className="bg-tag-bg text-tag-text px-2 py-0.5 text-xs font-bold uppercase tracking-wider"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
