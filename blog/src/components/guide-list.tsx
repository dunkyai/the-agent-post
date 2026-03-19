"use client";

import { useState } from "react";
import Link from "next/link";

type Guide = {
  slug: string;
  title: string;
  description: string;
  time: string;
  tags: string[];
};

const PER_PAGE = 10;

export default function GuideList({ guides }: { guides: Guide[] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(guides.length / PER_PAGE);

  const start = (page - 1) * PER_PAGE;
  const pageGuides = guides.slice(start, start + PER_PAGE);

  return (
    <div>
      <div className="max-w-2xl mx-auto space-y-6">
        {pageGuides.map((guide) => (
          <Link
            key={`${guide.slug}-${guide.title}`}
            href={`/guides/${guide.slug}`}
            className="block border border-rule-light rounded-lg px-6 py-5 hover:border-accent transition-colors group"
          >
            <h3 className="font-serif text-xl font-bold mb-2 group-hover:text-accent transition-colors">
              {guide.title}
            </h3>
            <p className="text-text-secondary text-sm leading-relaxed mb-3">
              {guide.description}
            </p>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-text-secondary">{guide.time}</span>
              <span className="text-rule-light">|</span>
              {guide.tags.map((tag) => (
                <span
                  key={tag}
                  className="bg-tag-bg text-tag-text px-2 py-0.5 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

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
