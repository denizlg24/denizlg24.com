import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { invalidateAfterWatching, useReportProgress } from "@/api/stream";
import { PROGRESS_INTERVAL_MS, shouldReportProgress } from "@/lib/time";
import type { PlayerController } from "./controller";

/**
 * `PUT /profiles/:id/progress` every ~10 s while playing, whenever playback
 * pauses, and once more when the player closes. Nothing is sent before the
 * duration is known, and an unavailable title never reports.
 */
export function useProgressReporter({
  controller,
  profileId,
  titleId,
  episodeId,
}: {
  controller: PlayerController;
  profileId: string;
  titleId: string;
  episodeId: string | null;
}) {
  const client = useQueryClient();
  const report = useReportProgress(profileId);
  const latest = useRef(controller);
  latest.current = controller;
  const sent = useRef<{ at: number | null; position: number | null }>({
    at: null,
    position: null,
  });
  const send = useRef<(force: boolean) => void>(() => undefined);
  send.current = (force: boolean) => {
    const { available, position, duration } = latest.current;
    if (!available || !(duration > 0)) return;
    const now = Date.now();
    const due = shouldReportProgress({
      now,
      force,
      lastSentAt: sent.current.at,
      lastSentPosition: sent.current.position,
      position,
    });
    if (!due) return;
    sent.current = { at: now, position };
    report.mutate({
      titleId,
      episodeId,
      positionS: Math.floor(position),
      durationS: Math.floor(duration),
    });
  };

  useEffect(() => {
    if (!controller.playing) return;
    const timer = setInterval(
      () => send.current(false),
      PROGRESS_INTERVAL_MS / 2,
    );
    return () => clearInterval(timer);
  }, [controller.playing]);

  const wasPlaying = useRef(false);
  useEffect(() => {
    if (wasPlaying.current && !controller.playing) send.current(true);
    wasPlaying.current = controller.playing;
  }, [controller.playing]);

  useEffect(
    () => () => {
      send.current(true);
      invalidateAfterWatching(client, profileId);
    },
    [client, profileId],
  );
}
