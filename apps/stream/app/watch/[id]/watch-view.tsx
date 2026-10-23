"use client";

import type { Episode, Playback } from "@repo/schemas/stream";
import { StreamPlayer } from "@repo/stream-player";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { reportProgress } from "@/app/actions";

export function WatchView({
  titleId,
  title,
  subtitle,
  episodeId,
  backdropUrl,
  playback,
}: {
  titleId: string;
  title: string;
  subtitle: string | null;
  episodeId: string | null;
  backdropUrl: string | null;
  playback: Playback;
}) {
  const router = useRouter();
  const onProgress = useCallback(
    (positionS: number, durationS: number) => {
      void reportProgress({ titleId, episodeId, positionS, durationS });
    },
    [titleId, episodeId],
  );
  const onBack = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push(`/title/${titleId}`);
  }, [router, titleId]);
  const onNext = useCallback(
    (episode: Episode) =>
      router.replace(`/watch/${titleId}?episode=${episode.id}`),
    [router, titleId],
  );
  return (
    <div className="fixed inset-0 bg-black" data-nav-own="all">
      <StreamPlayer
        key={episodeId ?? titleId}
        playback={playback}
        title={title}
        subtitle={subtitle}
        backdropUrl={backdropUrl}
        unavailableMessage="This one isn't available to play yet."
        onBack={onBack}
        onNext={onNext}
        onProgress={onProgress}
      />
    </div>
  );
}
