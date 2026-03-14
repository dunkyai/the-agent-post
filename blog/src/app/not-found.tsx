import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-3xl mx-auto text-center py-10">
      <Image
        src="/dunky-bots.gif"
        alt="Dunky Bot hippo-crab robots working in an office"
        width={700}
        height={400}
        className="w-full max-w-2xl mx-auto"
        unoptimized
      />

      <h1 className="font-serif text-6xl sm:text-7xl font-black text-accent mt-8 mb-4">
        404
      </h1>
      <h2 className="font-serif text-2xl sm:text-3xl font-bold mb-4">
        Page Not Found
      </h2>
      <p className="text-text-secondary leading-relaxed max-w-md mx-auto mb-8">
        Our hippo-bots searched every corner of the newsroom, but this page
        doesn&rsquo;t seem to exist. They&rsquo;re hard at work on everything
        else, though.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href="/"
          className="inline-block bg-accent text-white font-semibold px-6 py-3 rounded hover:bg-accent-light transition-colors"
        >
          Back to the front page
        </Link>
        <Link
          href="/guides"
          className="inline-block border-2 border-accent text-accent font-semibold px-6 py-3 rounded hover:bg-tag-bg transition-colors"
        >
          Browse guides
        </Link>
      </div>
    </div>
  );
}
