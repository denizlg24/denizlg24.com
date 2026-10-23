import type { Episode, Playback, Progress } from "@repo/schemas/stream";

export function nextEpisode(
  all: Episode[],
  currentId: string | null,
): Episode | null {
  const index = all.findIndex((episode) => episode.id === currentId);
  return index < 0 ? null : (all[index + 1] ?? null);
}

export function selectPlayback(
  title: { id: string; type: string },
  all: Episode[],
  progress: Progress | null,
  requested: string | null,
): Playback {
  const playable = all.filter(
    (episode) =>
      episode.season !== null &&
      episode.season >= 0 &&
      episode.episode !== null &&
      episode.episode > 0,
  );
  const previous = playable.find(
    (episode) => episode.id === progress?.episodeId,
  );
  const selected = requested
    ? playable.find((episode) => episode.id === requested)
    : previous && progress?.completed
      ? (nextEpisode(playable, previous.id) ?? previous)
      : (previous ??
        playable.find((episode) => episode.season! > 0) ??
        playable[0]);
  if (requested && (title.type === "movie" || !selected)) {
    throw new RangeError("episode_not_found");
  }
  const episode = title.type === "movie" ? null : (selected ?? null);
  const path =
    title.type === "movie"
      ? `movie/${title.id}`
      : episode
        ? `tv/${title.id}/${episode.season}/${episode.episode}`
        : null;
  return {
    sources: [],
    textTracks: [],
    embed: path
      ? { provider: "vidsrc", url: `https://vidsrc.mov/embed/${path}` }
      : null,
    episode,
    resume:
      progress &&
      !progress.completed &&
      progress.episodeId === (episode?.id ?? null)
        ? progress
        : null,
    next: episode ? nextEpisode(playable, episode.id) : null,
  };
}
