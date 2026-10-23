import { titleIdSchema, tmdbImage } from "@repo/schemas/stream";
import { episodeLabel } from "@repo/stream-player";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WatchView } from "@/app/watch/[id]/watch-view";
import { findTitle, listEpisodes } from "@/lib/catalog";
import { playbackFor } from "@/lib/playback";
import { requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Watch" };

export default async function WatchPage({
  params,
  searchParams,
}: PageProps<"/watch/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const requested = titleIdSchema.safeParse(query.episode);
  const viewer = await requireViewer(`/watch/${id}`);
  const title = await findTitle(id);
  if (!title) notFound();
  const playback = await playbackFor(
    title,
    viewer.audience[0].id,
    requested.success ? requested.data : null,
  );
  const episodes =
    title.type === "movie" ? [] : await listEpisodes(title.id, null);
  const episodeId =
    (requested.success ? requested.data : null) ??
    playback.resume?.episodeId ??
    episodes[0]?.id ??
    null;
  const episode = episodes.find((item) => item.id === episodeId) ?? null;
  return (
    <WatchView
      titleId={title.id}
      title={title.title}
      subtitle={episode ? episodeLabel(episode) : null}
      episodeId={episode?.id ?? null}
      backdropUrl={tmdbImage(title.backdropPath, "w1280")}
      playback={playback}
    />
  );
}
