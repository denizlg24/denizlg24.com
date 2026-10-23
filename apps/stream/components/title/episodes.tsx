"use client";

import {
  type Episode,
  episodeSchema,
  formatRuntime,
  tmdbImage,
} from "@repo/schemas/stream";
import { Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Rating } from "@/components/rating";

const responseSchema = z.object({ episodes: z.array(episodeSchema) });

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
    <section className="space-y-6">
      <div className="flex items-baseline gap-6 border-b border-hairline">
        <h2 className="pb-4 font-display text-3xl">Episodes</h2>
        <div
          role="tablist"
          aria-label="Seasons"
          className="scrollbar-none flex gap-1 overflow-x-auto"
        >
          {seasons.map((number) => (
            <button
              key={number}
              type="button"
              role="tab"
              aria-selected={season === number}
              data-nav
              onClick={() => setSeason(number)}
              className={`relative px-3 pb-4 text-sm font-bold transition-colors ${season === number ? "text-paper" : "text-muted hover:text-paper"}`}
            >
              Season {number}
              {season === number ? (
                <span className="absolute inset-x-2 -bottom-px h-px bg-amber" />
              ) : null}
            </button>
          ))}
        </div>
      </div>
      {failed ? (
        <div className="space-y-3 text-muted">
          <p>The episode list didn't load.</p>
          <button
            type="button"
            data-nav
            onClick={() => setAttempt((value) => value + 1)}
            className="rounded-full border border-hairline px-4 py-2 text-paper hover:bg-raised"
          >
            Try again
          </button>
        </div>
      ) : episodes === null ? (
        <ul className="space-y-3">
          {[0, 1, 2, 3].map((key) => (
            <li key={key} className="h-14 animate-pulse rounded-lg bg-raised" />
          ))}
        </ul>
      ) : episodes.length === 0 ? (
        <p className="text-muted">
          There aren't any episodes listed for this season yet. Try another
          season.
        </p>
      ) : (
        <ol className="divide-y divide-hairline">
          {episodes.map((episode) => (
            <li key={episode.id}>
              <Link
                href={`/watch/${seriesId}?episode=${episode.id}`}
                data-nav
                className="group grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-4 rounded-lg px-2 py-4 transition-colors hover:bg-raised/60 md:grid-cols-[10rem_minmax(0,1fr)_auto]"
              >
                <span className="relative aspect-video overflow-hidden rounded-lg bg-raised">
                  {episode.stillPath ? (
                    <img
                      src={tmdbImage(episode.stillPath, "w500")!}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <Play className="absolute inset-0 m-auto size-6 text-muted" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block font-bold text-paper">
                    {episode.episode}.{" "}
                    {episode.title ?? `Episode ${episode.episode ?? ""}`}
                  </span>
                  {episode.overview ? (
                    <span className="mt-1 line-clamp-2 text-sm text-muted">
                      {episode.overview}
                    </span>
                  ) : null}
                  {currentEpisodeId === episode.id ? (
                    <span className="text-sm text-amber">
                      {completed ? "Watched" : "You're here"}
                    </span>
                  ) : null}
                  <span className="text-sm text-muted md:hidden">
                    {formatRuntime(episode.runtimeMinutes)}
                  </span>
                </span>
                <span className="hidden items-center gap-4 text-sm text-paper/70 md:flex">
                  {episode.rating ? <Rating value={episode.rating} /> : null}
                  <span>{formatRuntime(episode.runtimeMinutes)}</span>
                  <Play className="size-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
