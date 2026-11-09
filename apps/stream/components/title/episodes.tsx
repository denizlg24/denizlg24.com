"use client";

import {
  type Episode,
  episodeSchema,
  formatRuntime,
  tmdbImage,
} from "@repo/schemas/stream";
import { ChevronDown, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";

const responseSchema = z.object({ episodes: z.array(episodeSchema) });

function EpisodeSkeleton() {
  return (
    <ol aria-hidden className="divide-y divide-hairline">
      {[0, 1, 2, 3].map((key) => (
        <li
          key={key}
          className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-4 py-4 sm:grid-cols-[1.5rem_minmax(0,9rem)_minmax(0,1fr)]"
        >
          <span className="hidden h-5 animate-pulse rounded bg-lift sm:block" />
          <span className="aspect-video animate-pulse rounded-[4px] bg-lift" />
          <span className="space-y-2">
            <span className="block h-4 w-2/3 animate-pulse rounded bg-lift" />
            <span className="block h-3 w-full animate-pulse rounded bg-lift" />
            <span className="block h-3 w-5/6 animate-pulse rounded bg-lift" />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Episodes({
  seriesId,
  seasons,
  initialSeason,
  currentEpisodeId,
  completed = false,
}: {
  seriesId: string;
  seasons: number[];
  initialSeason: number;
  currentEpisodeId: string | null;
  completed?: boolean;
}) {
  const [season, setSeason] = useState(initialSeason);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setEpisodes(null);
    setFailed(false);
    fetch(`/api/v1/titles/${seriesId}/episodes?season=${season}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        setEpisodes(responseSchema.parse(await response.json()).episodes);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [seriesId, season, attempt]);

  return (
    <section className="space-y-4" aria-labelledby="episodes-heading">
      <div className="flex items-center justify-between gap-4">
        <h3 id="episodes-heading" className="text-2xl font-bold">
          Episodes
        </h3>
        {seasons.length > 1 ? (
          <label className="relative shrink-0">
            <span className="sr-only">Season</span>
            <select
              value={season}
              onChange={(event) => setSeason(Number(event.target.value))}
              data-nav
              className="h-10 appearance-none rounded-[4px] border border-paper/40 bg-lift py-0 pr-10 pl-4 text-base font-bold text-paper outline-none focus-visible:border-amber"
            >
              {seasons.map((number) => (
                <option key={number} value={number}>
                  Season {number}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
              aria-hidden
            />
          </label>
        ) : seasons.length === 1 ? (
          <span className="shrink-0 text-paper/70">Season {seasons[0]}</span>
        ) : null}
      </div>
      {failed ? (
        <div className="space-y-3 py-4 text-paper/70">
          <p>The episode list didn't load.</p>
          <button
            type="button"
            data-nav
            onClick={() => setAttempt((value) => value + 1)}
            className="rounded-[4px] border border-paper/40 px-4 py-2 text-paper hover:bg-paper/10"
          >
            Try again
          </button>
        </div>
      ) : episodes === null ? (
        <EpisodeSkeleton />
      ) : episodes.length === 0 ? (
        <p className="py-4 text-paper/70">
          There aren't any episodes listed for this season yet. Try another
          season.
        </p>
      ) : (
        <ol className="divide-y divide-hairline border-t border-hairline">
          {episodes.map((episode) => {
            const current = currentEpisodeId === episode.id;
            const still = tmdbImage(episode.stillPath ?? null, "w342");
            return (
              <li key={episode.id}>
                <Link
                  href={`/watch/${seriesId}?episode=${episode.id}`}
                  data-nav
                  aria-current={current ? "true" : undefined}
                  className={`group grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-4 rounded-[4px] px-2 py-4 transition-colors hover:bg-paper/5 sm:grid-cols-[1.5rem_minmax(0,9rem)_minmax(0,1fr)] sm:px-4 ${current ? "bg-paper/5" : ""}`}
                >
                  <span className="hidden text-center text-xl text-paper/60 sm:block">
                    {episode.episode ?? ""}
                  </span>
                  <span className="relative aspect-video overflow-hidden rounded-[4px] bg-lift">
                    {still ? (
                      <img
                        src={still}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : null}
                    <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <span className="grid size-9 place-items-center rounded-full border-2 border-paper bg-ink/50">
                        <Play
                          className="size-4 translate-x-px fill-paper"
                          strokeWidth={0}
                        />
                      </span>
                    </span>
                  </span>
                  <span className="min-w-0 space-y-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-bold">
                        <span className="sm:hidden">{episode.episode}. </span>
                        {episode.title ?? `Episode ${episode.episode ?? ""}`}
                      </span>
                      <span className="shrink-0 text-sm text-paper/70">
                        {formatRuntime(episode.runtimeMinutes)}
                      </span>
                    </span>
                    {episode.overview ? (
                      <span className="line-clamp-3 text-sm leading-snug text-paper/70">
                        {episode.overview}
                      </span>
                    ) : null}
                    {current ? (
                      <span className="block text-sm text-amber">
                        {completed ? "Watched" : "You're here"}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
