"use client";

import {
  type Episode,
  episodeSchema,
  formatRuntime,
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
}: {
  seriesId: string;
  seasons: number[];
  initialSeason: number;
  currentEpisodeId: string | null;
}) {
  const [season, setSeason] = useState(initialSeason);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [failed, setFailed] = useState(false);

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
  }, [seriesId, season]);

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
        <p className="text-muted">
          The episode list didn't load. Please try again shortly.
        </p>
      ) : episodes === null ? (
        <ul className="space-y-3">
          {[0, 1, 2, 3].map((key) => (
            <li key={key} className="h-14 animate-pulse rounded-lg bg-raised" />
          ))}
        </ul>
      ) : (
        <ol className="divide-y divide-hairline">
          {episodes.map((episode) => (
            <li key={episode.id}>
              <Link
                href={`/watch/${seriesId}?episode=${episode.id}`}
                data-nav
                className="group grid grid-cols-[3rem_1fr_auto] items-center gap-4 rounded-lg px-2 py-4 transition-colors hover:bg-raised/60"
              >
                <span className="font-display text-3xl text-paper/35 group-hover:text-amber group-focus-visible:text-amber">
                  {episode.episode ?? "–"}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-paper">
                    {episode.title ?? `Episode ${episode.episode ?? ""}`}
                  </span>
                  {currentEpisodeId === episode.id ? (
                    <span className="text-xs text-amber">You're here</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-4 text-sm text-paper/60">
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
