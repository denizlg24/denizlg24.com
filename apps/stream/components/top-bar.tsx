import type { Profile, ProfileLayout } from "@repo/schemas/stream";
import { Play, Search } from "lucide-react";
import Link from "next/link";

import { NavLinks } from "@/components/nav-links";
import { joinNames, ProfileDisc } from "@/components/profile-disc";

const STUDIO = [
  { href: "/", label: "Tonight" },
  { href: "/tune", label: "Tune" },
  { href: "/map", label: "Map" },
  { href: "/shelf", label: "Shelf" },
  { href: "/ask", label: "Ask" },
];

const CLASSIC = [
  { href: "/", label: "Home" },
  { href: "/search", label: "Search" },
  { href: "/ask", label: "Ask for ideas" },
  { href: "/my-list", label: "My list" },
];

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-display text-[1.75rem] leading-none font-black uppercase ${className}`}
    >
      <Play
        className="size-[0.62em] fill-amber text-amber"
        strokeWidth={0}
        aria-hidden
      />
      Stream
    </span>
  );
}

export function TopBar({
  audience,
  layout,
  overlay = false,
}: {
  audience: Profile[];
  layout: ProfileLayout;
  overlay?: boolean;
}) {
  const classic = layout === "classic";
  return (
    <header
      className={`${overlay ? "absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-ink/80 to-transparent" : "sticky top-0 z-30 border-b border-hairline bg-ink/85 backdrop-blur-md"} pt-[env(safe-area-inset-top)]`}
    >
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-5 md:gap-10 md:px-10">
        <Link
          href="/"
          data-nav
          className="rounded-md"
          aria-label="Stream, home"
        >
          <Wordmark />
        </Link>
        <NavLinks items={classic ? CLASSIC : STUDIO} classic={classic} />
        <div className="ml-auto flex items-center gap-3">
          {classic ? null : (
            <Link
              href="/tune?focus=search"
              data-nav
              aria-label="Search"
              className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:text-paper"
            >
              <Search className="size-5" strokeWidth={1.75} />
            </Link>
          )}
          <Link
            href="/sofa"
            data-nav
            className="group flex items-center gap-3 rounded-full py-1 pr-1 pl-3 transition-colors hover:bg-raised"
            aria-label={`Watching: ${joinNames(audience.map((p) => p.name))}. Change who's watching`}
          >
            <span className="hidden text-sm text-muted group-hover:text-paper sm:inline">
              {classic
                ? "Who's watching"
                : joinNames(audience.map((p) => p.name))}
            </span>
            <span className="flex -space-x-2">
              {audience.map((profile) => (
                <ProfileDisc
                  key={profile.id}
                  name={profile.name}
                  color={profile.color}
                  size="sm"
                  className="ring-2 ring-ink"
                />
              ))}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
