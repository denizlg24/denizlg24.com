import {
  genreSchema,
  STREAM_GENRES,
  titleQuerySchema,
} from "@repo/schemas/stream";
import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { TitleRow } from "@/components/classic/title-row";
import { TopBar } from "@/components/top-bar";
import { queryTitles } from "@/lib/catalog";
import { audienceProfiles, requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Search" };

const KINDS = [
  { value: "", label: "Everything" },
  { value: "movie", label: "Films" },
  { value: "series", label: "Series" },
];

export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  const viewer = await requireViewer("/search");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const kind = typeof params.kind === "string" ? params.kind : "";
  const genre = genreSchema.safeParse(params.genre);
  const browsing = q.trim().length > 0 || genre.success || kind !== "";
  const kids = viewer.audience.some((profile) => profile.kids);
  const query = titleQuerySchema.parse({
    q: q.trim() || undefined,
    type: kind || undefined,
    genres: genre.success ? [genre.data] : undefined,
    sort: q.trim() ? "votes" : "popular",
    limit: 40,
  });
  const results = browsing ? await queryTitles(query, kids) : null;
  const link = (next: Record<string, string>) => {
    const merged = new URLSearchParams({
      ...(q ? { q } : {}),
      ...(kind ? { kind } : {}),
      ...(genre.success ? { genre: genre.data } : {}),
      ...next,
    });
    for (const [key, value] of [...merged.entries()])
      if (!value) merged.delete(key);
    return `/search?${merged.toString()}`;
  };

  return (
    <div className="min-h-dvh">
      <TopBar audience={audienceProfiles(viewer)} layout={viewer.layout} />
      <main className="mx-auto max-w-4xl space-y-10 px-6 py-10">
        <h1 className="text-5xl font-semibold">Find something to watch</h1>
        <form
          action="/search"
          className="flex items-center gap-4 rounded-2xl bg-raised px-6 py-5 ring-2 ring-transparent focus-within:ring-amber"
        >
          <Search className="size-7 shrink-0 text-muted" />
          <label className="flex-1">
            <span className="sr-only">Name of a film or series</span>
            <input
              name="q"
              defaultValue={q}
              data-nav-autofocus={browsing ? undefined : ""}
              data-nav
              placeholder="Type the name of a film or series"
              className="w-full bg-transparent text-2xl outline-none placeholder:text-faint"
            />
          </label>
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          <button
            type="submit"
            data-nav
            className="rounded-xl bg-paper px-6 py-3 text-xl font-semibold text-ink"
          >
            Search
          </button>
        </form>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {KINDS.map((option) => (
              <Link
                key={option.label}
                href={link({ kind: option.value })}
                data-nav
                aria-current={kind === option.value ? "true" : undefined}
                className={`rounded-full px-6 py-3 text-xl ${kind === option.value ? "bg-paper text-ink" : "bg-raised text-paper"}`}
              >
                {option.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-2.5">
            {STREAM_GENRES.map((name) => {
              const active = genre.success && genre.data === name;
              return (
                <Link
                  key={name}
                  href={link({ genre: active ? "" : name })}
                  data-nav
                  aria-current={active ? "true" : undefined}
                  className={`rounded-full px-4 py-2 text-lg ${active ? "bg-amber text-ink" : "text-muted ring-1 ring-hairline hover:text-paper"}`}
                >
                  {name}
                </Link>
              );
            })}
          </div>
        </div>
        {results === null ? (
          <p className="text-xl text-muted">
            Search by name, or choose a kind or a genre above to browse.
          </p>
        ) : results.titles.length === 0 ? (
          <div className="space-y-2 py-10">
            <p className="text-3xl font-semibold">Nothing found</p>
            <p className="text-xl text-muted">
              Check the spelling, or try just one word from the name.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {results.titles.map((title) => (
              <TitleRow key={title.id} title={title} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
