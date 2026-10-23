import type { Episode } from "@repo/schemas/stream";
import { z } from "zod";

const seasonSchema = z.object({
  episodes: z.array(
    z.object({
      episode_number: z.number().int(),
      name: z.string().nullish(),
      overview: z.string().nullish(),
      still_path: z.string().nullish(),
      runtime: z.number().int().nullish(),
    }),
  ),
});

/** One cached request per season. IMDb remains authoritative for identity/order. */
export async function episodePreviews(
  episodes: Episode[],
  tmdbId: number | null,
  season: number,
): Promise<Episode[]> {
  if (!tmdbId || !process.env.STREAM_TMDB_TOKEN || episodes.length === 0)
    return episodes;
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}`,
      {
        headers: {
          authorization: `Bearer ${process.env.STREAM_TMDB_TOKEN}`,
          accept: "application/json",
        },
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return episodes;
    const data = seasonSchema.parse(await response.json());
    const previews = new Map(
      data.episodes.map((episode) => [episode.episode_number, episode]),
    );
    return episodes.map((episode) => {
      const preview =
        episode.episode === null ? undefined : previews.get(episode.episode);
      return preview
        ? {
            ...episode,
            title: episode.title || preview.name || null,
            runtimeMinutes: episode.runtimeMinutes ?? preview.runtime ?? null,
            overview: preview.overview || null,
            stillPath: preview.still_path || null,
          }
        : episode;
    });
  } catch {
    return episodes;
  }
}
