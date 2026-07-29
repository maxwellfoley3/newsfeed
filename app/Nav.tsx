"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Following" },
  { href: "/for-you", label: "For You" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav
      className="sticky top-0 z-10 border-b backdrop-blur"
      style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--bg) 82%, transparent)" }}
    >
      <div className="mx-auto flex max-w-2xl items-center gap-1 px-5">
        {TABS.map((tab) => {
          // Following owns "/" and the single-source pages under it.
          const active =
            tab.href === "/" ? pathname === "/" || pathname.startsWith("/source/") : pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="relative px-2 py-3.5 text-sm font-medium transition-colors"
              style={{ color: active ? "var(--ink)" : "var(--muted)" }}
            >
              {tab.label}
              {active && (
                <span
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
