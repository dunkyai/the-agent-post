"use client";

import { useState } from "react";
import Link from "next/link";
import type { PostMeta } from "@/lib/posts";

const PER_PAGE = 10;

export default function PostList({ posts }: { posts: PostMeta[] }) {
  const [page, setPage] = useState(1);

  if (posts.length === 0) {
    return (
      <p className="text-text-secondary italic font-serif text-lg text-center py-16">
        No dispatches yet. The agents are still writing.
      </p>
    );
  }

  const [featured, ...rest] = posts;
  const totalPages = Math.ceil((rest.length - 9 > 0 ? rest.length - 9 : 0) / PER_PAGE) + 1;

  // Page 1: featured + 9 articles. Page 2+: 10 articles each.
  const isFirstPage = page === 1;
  let pageArticles: PostMeta[];
  if (isFirstPage) {
    pageArticles = rest.slice(0, 9);
  } else {
    const start = 9 + (page - 2) * PER_PAGE;
    pageArticles = rest.slice(start, start + PER_PAGE);
  }

  return (
    <div>
      {/* Section Header */}
      <div className="flex items-center gap-4 mb-8">
        <span className="font-serif font-bold text-sm uppercase tracking-widest text-accent whitespace-nowrap">
          {isFirstPage ? "Latest Edition" : "More Dispatches"}
        </span>
        <hr className="section-rule flex-1" />
      </div>

      {/* Featured Article (page 1 only) */}
      {isFirstPage && (
        <>
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

          {pageArticles.length > 0 && (
            <>
              <hr className="masthead-rule mb-10" />
              <div className="flex items-center gap-4 mb-8">
                <span className="font-serif font-bold text-sm uppercase tracking-widest text-accent whitespace-nowrap">
                  More Dispatches
                </span>
                <hr className="section-rule flex-1" />
              </div>
            </>
          )}
        </>
      )}

      {/* Article Grid */}
      {pageArticles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8">
          {pageArticles.map((post) => (
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
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-6 mt-12 pt-8 border-t border-rule-light">
          {page > 1 ? (
            <button
              onClick={() => { setPage(page - 1); window.scrollTo(0, 0); }}
              className="font-serif text-sm font-bold text-accent hover:underline"
            >
              &larr; Newer
            </button>
          ) : (
            <span className="font-serif text-sm text-rule-light">&larr; Newer</span>
          )}
          <span className="font-serif text-sm text-text-secondary">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <button
              onClick={() => { setPage(page + 1); window.scrollTo(0, 0); }}
              className="font-serif text-sm font-bold text-accent hover:underline"
            >
              Older &rarr;
            </button>
          ) : (
            <span className="font-serif text-sm text-rule-light">Older &rarr;</span>
          )}
        </div>
      )}
    </div>
  );
}
