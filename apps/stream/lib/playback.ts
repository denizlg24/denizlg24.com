import "server-only";

import type { Playback } from "@repo/schemas/stream";

import type { TitleRow } from "@/db/schema";
import { findProgress, listEpisodes } from "@/lib/catalog";
import { selectPlayback } from "./playback-selection";

/**
 * Embeds stay separate from direct media sources: clients must open them in
 * an iframe/WebView, and must not fabricate timestamp progress for them.
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
  return selectPlayback(title, episodes, resume, episodeId);
}
