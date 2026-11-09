import { titleQuerySchema, tmdbImage } from "@repo/schemas/stream";
import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PosterTile } from "@/components/browse/tiles";
import { SearchField } from "@/components/nav/search-field";
import { ProfileDisc } from "@/components/profile-disc";
import { audienceRules } from "@/lib/audience-rules";
import { queryTitles } from "@/lib/catalog";
import { searchCatalogue } from "@/lib/search";
import { requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Search" };

function Chip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        data-nav
        className="flex max-w-[16rem] items-center gap-2 rounded-full border border-paper/25 px-3.5 py-1.5 text-sm text-paper/90 transition-colors hover:border-paper/60 hover:text-paper"
      >
        {children}
      </Link>
    </li>
  );
}

function AskLink() {
  return (
    <Link
      href="/ask"
      data-nav
      className="inline-flex items-center gap-2 rounded text-sm text-paper/60 transition-colors hover:text-paper"
    >
      <Sparkles className="size-4 shrink-0 text-amber" aria-hidden />
      Not sure what to watch? Ask Stream for ideas
    </Link>
  );
}

export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 120);
  const viewer = await requireViewer(
    q ? `/search?q=${encodeURIComponent(q)}` : "/search",
  );
  const rules = audienceRules(viewer.audience);
  const result = await searchCatalogue({ q, rules, type: null });
  const titles =
    result.titles.length > 0 || q
      ? result.titles
      : (
          await queryTitles(
            titleQuerySchema.parse({ sort: "popular", limit: 42 }),
            rules,
          )
        ).titles;
  const explore =
    result.people.length + result.genres.length + result.keywords.length > 0;

  return (
    <div className="space-y-6 px-[var(--gutter)] pt-20 pb-20 sm:pt-24 md:space-y-8 md:pt-28">
      <Suspense>
        <SearchField className="sm:hidden" />
      </Suspense>

      {q && explore ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="shrink-0 text-paper/60">More to explore:</span>
          <ul className="flex min-w-0 flex-wrap gap-2">
            {result.people.map((person) => (
              <Chip
                key={`person-${person.name}`}
                href={`/actor/${encodeURIComponent(person.name)}`}
              >
                {person.profilePath ? (
                  <img
                    src={tmdbImage(person.profilePath, "w92") ?? ""}
                    alt=""
                    loading="lazy"
                    className="size-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <ProfileDisc
                    name={person.name}
                    color="sand"
                    size="xs"
                    className="!size-6 !rounded-full !text-xs"
                  />
                )}
                <span className="truncate">{person.name}</span>
              </Chip>
            ))}
            {result.genres.map((genre) => (
              <Chip
                key={`genre-${genre}`}
                href={`/browse?genres=${encodeURIComponent(genre)}`}
              >
                <span className="truncate">{genre}</span>
              </Chip>
            ))}
            {result.keywords.map((keyword) => (
              <Chip
                key={`keyword-${keyword}`}
                href={`/browse?keyword=${encodeURIComponent(keyword)}`}
              >
                <span className="truncate">{keyword}</span>
              </Chip>
            ))}
          </ul>
        </div>
      ) : null}

      {titles.length > 0 ? (
        <section className="space-y-4" aria-labelledby="results-heading">
          <h1
            id="results-heading"
            className="text-[clamp(1.25rem,1.8vw,1.8rem)] font-bold break-words"
          >
            {q ? `Results for “${q}”` : "Popular on Stream"}
          </h1>
          <div className="title-grid">
            <ul>
              {titles.map((title) => (
                <li key={title.id} className="min-w-0">
                  <PosterTile title={title} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : q ? (
        <div className="mx-auto max-w-lg space-y-4 py-12">
          <h1 className="text-xl break-words">
            Your search for “{q}” didn't find anything.
          </h1>
          <ul className="list-disc space-y-1 pl-5 text-paper/70">
            <li>Check the spelling, or try just one word from the name</li>
            <li>Try the name of an actor or a director</li>
            <li>Try a genre, like comedy or animation</li>
          </ul>
        </div>
      ) : (
        <p className="py-12 text-center text-paper/70">
          Start typing to search films, series and people.
        </p>
      )}

      <div className="pt-4">
        <AskLink />
      </div>
    </div>
  );
}
