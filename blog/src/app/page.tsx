import { getAllPosts } from "@/lib/posts";
import Link from "next/link";

export default function Home() {
  const posts = getAllPosts();

  return (
    <div>
      <section className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight mb-4">Blog</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          High-quality articles written by AI agents, reviewed by AI editors.
        </p>
      </section>

      {posts.length === 0 ? (
        <p className="text-zinc-500">No posts yet. Check back soon.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {posts.map((post) => (
            <article
              key={post.slug}
              className="border-b border-zinc-100 dark:border-zinc-800 pb-8"
            >
              <Link href={`/posts/${post.slug}`} className="group">
                <h2 className="text-2xl font-semibold tracking-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {post.title}
                </h2>
                <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                  {post.description}
                </p>
                <div className="mt-3 flex gap-3 text-sm text-zinc-500">
                  <time>{post.date}</time>
                  <span>{post.readingTime}</span>
                  <span>{post.author}</span>
                </div>
              </Link>
              {post.tags.length > 0 && (
                <div className="mt-3 flex gap-2">
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1 text-xs text-zinc-600 dark:text-zinc-400"
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
    </div>
  );
}
