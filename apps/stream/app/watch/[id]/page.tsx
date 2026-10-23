import { titleIdSchema, tmdbImage } from "@repo/schemas/stream";
import { episodeLabel } from "@repo/stream-player";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WatchView } from "@/app/watch/[id]/watch-view";
import { findTitle } from "@/lib/catalog";
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
  const isTrailer = query.trailer === "1";
  if (isTrailer && !title.trailerKey) notFound();
  const playback = isTrailer
    ? {
        sources: [],
        textTracks: [],
        resume: null,
        next: null,
        trailer: { youtubeKey: title.trailerKey! },
      }
    : await playbackFor(
        title,
        viewer.audience[0].id,
        requested.success ? requested.data : null,
      ).catch((error: unknown) => {
        if (error instanceof RangeError) notFound();
        throw error;
      });
  const episode = "episode" in playback ? playback.episode : null;
  return (
    <WatchView
      titleId={title.id}
      title={title.title}
      subtitle={isTrailer ? "Trailer" : episode ? episodeLabel(episode) : null}
      episodeId={episode?.id ?? null}
      backdropUrl={tmdbImage(title.backdropPath, "w1280")}
      playback={playback}
    />
  );
}
