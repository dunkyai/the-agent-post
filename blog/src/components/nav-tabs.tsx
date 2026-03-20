"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { label: "News", href: "/" },
  { label: "Topics", href: "/tags" },
  { label: "Guides", href: "/guides" },
  { label: "Products & Services", href: "/products" },
];

export default function NavTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex justify-center gap-8 py-3">
      {tabs.map(({ label, href }) => {
        const isActive =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`font-serif text-sm uppercase tracking-widest pb-2 border-b-2 transition-colors ${
              isActive
                ? "text-accent border-accent font-bold"
                : "text-text-secondary border-transparent hover:text-foreground"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
