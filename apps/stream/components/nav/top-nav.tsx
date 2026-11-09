"use client";

import type { Profile } from "@repo/schemas/stream";
import { ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Wordmark } from "@/components/brand";
import { ProfileMenu } from "@/components/nav/profile-menu";
import { SearchField } from "@/components/nav/search-field";
import { usePopover } from "@/components/nav/use-popover";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/series", label: "Series" },
  { href: "/films", label: "Films" },
  { href: "/new", label: "New & Popular" },
  { href: "/my-list", label: "My List" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function BrowseMenu({ pathname }: { pathname: string }) {
  const { open, setOpen, root } = usePopover<HTMLDivElement>();
  return (
    <div ref={root} className="relative lg:hidden">
      <button
        type="button"
        data-nav
        data-popover-trigger
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded px-1 py-1 text-sm font-bold whitespace-nowrap"
      >
        Browse
        <ChevronDown
          className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <nav
          aria-label="Browse"
          className="absolute top-[calc(100%+0.75rem)] left-1/2 w-56 -translate-x-1/2 border-t-2 border-paper bg-ink/95 py-2 shadow-2xl backdrop-blur-md"
        >
          {LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                data-nav
                aria-current={active ? "page" : undefined}
                className={`block px-4 py-3 text-center text-sm transition-colors hover:bg-paper/5 ${active ? "font-bold text-paper" : "text-paper/70"}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

/**
 * The fixed bar over every browse page: a gradient over the billboard that
 * turns solid once the page scrolls.
 */
export function TopNav({
  audience,
  profiles,
  logoutUrl,
}: {
  audience: Profile[];
  profiles: Profile[];
  logoutUrl: string;
}) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)] transition-colors duration-500 ${scrolled ? "bg-ink" : "bg-[linear-gradient(180deg,rgb(12_11_10/0.75)_10%,transparent)]"}`}
    >
      <div className="flex h-16 items-center gap-4 px-[var(--gutter)] md:h-[4.25rem] lg:gap-10">
        <Link
          href="/"
          data-nav
          aria-label="Stream, home"
          className="shrink-0 rounded"
        >
          <Wordmark className="text-[1.6rem] md:text-[2rem]" />
        </Link>
        <nav
          aria-label="Main"
          className="hidden min-w-0 items-center gap-5 lg:flex"
        >
          {LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                data-nav
                aria-current={active ? "page" : undefined}
                className={`rounded text-sm whitespace-nowrap transition-colors ${active ? "font-bold text-paper" : "text-paper/80 hover:text-paper/60"}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <BrowseMenu pathname={pathname} />
        <div className="ml-auto flex min-w-0 items-center gap-3 md:gap-5">
          <Suspense fallback={<span className="size-10" />}>
            <SearchField expanding className="hidden sm:flex" />
          </Suspense>
          <Link
            href="/search"
            data-nav
            aria-label="Search"
            className="grid size-10 shrink-0 place-items-center rounded-full sm:hidden"
          >
            <Search className="size-[1.35rem]" strokeWidth={2} />
          </Link>
          <ProfileMenu
            audience={audience}
            profiles={profiles}
            logoutUrl={logoutUrl}
          />
        </div>
      </div>
    </header>
  );
}
