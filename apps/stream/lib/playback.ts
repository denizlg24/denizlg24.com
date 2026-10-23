import "server-only";

import type { Episode, Playback } from "@repo/schemas/stream";

import type { TitleRow } from "@/db/schema";
import { findProgress, listEpisodes } from "@/lib/catalog";

export function nextEpisode(
  all: Episode[],
  currentId: string | null,
): Episode | null {
  if (currentId === null) return null;
  const index = all.findIndex((episode) => episode.id === currentId);
  return index === -1 ? null : (all[index + 1] ?? null);
}

/**
 * What the player may open for a title. Sources come only from files on our
 * own storage; no title has one yet, so this answers an empty list and the
 * players show their unavailable state.
 */
export async function playbackFor(
  title: TitleRow,
  profileId: string | null,
  episodeId: string | null,
): Promise<Playback> {
  const [resume, episodes] = await Promise.all([
    profileId ? findProgress(profileId, title.id) : null,
    title.type === "movie" ? [] : listEpisodes(title.id, null),
  ]);
  const current = episodeId ?? resume?.episodeId ?? episodes[0]?.id ?? null;
  return {
    sources: [],
    textTracks: [],
    resume:
      resume &&
      !resume.completed &&
      resume.episodeId === (episodeId ?? resume.episodeId)
        ? resume
        : null,
    next: nextEpisode(episodes, current),
  };
}
