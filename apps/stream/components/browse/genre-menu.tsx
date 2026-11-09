"use client";

import { STREAM_GENRES } from "@repo/schemas/stream";
import { ChevronDown } from "lucide-react";
import Link from "next/link";

import { usePopover } from "@/components/nav/use-popover";

/** The "Genres" picker beside the Series and Films headings. */
export function GenreMenu({ type }: { type: "movie" | "series" }) {
  const { open, setOpen, root } = usePopover<HTMLDivElement>();
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        data-nav
        data-popover-trigger
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-8 items-center gap-6 border border-paper/80 bg-ink px-2.5 text-sm font-bold whitespace-nowrap hover:bg-paper/10"
      >
        Genres
        <ChevronDown
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <ul className="absolute top-full left-0 z-30 mt-px grid w-[min(30rem,calc(100vw-2*var(--gutter)))] grid-cols-2 border border-hairline bg-ink/95 py-2 shadow-2xl backdrop-blur-md sm:grid-cols-3">
          {STREAM_GENRES.map((genre) => (
            <li key={genre}>
              <Link
                href={`/browse?type=${type}&genres=${encodeURIComponent(genre)}`}
                data-nav
                className="block truncate px-4 py-1.5 text-sm text-paper/85 hover:underline"
              >
                {genre}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
