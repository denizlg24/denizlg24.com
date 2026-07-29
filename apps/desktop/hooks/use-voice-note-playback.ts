"use client";

import type { IVoiceNote } from "@repo/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";

/**
 * Playback for one voice note. The audio is fetched through the authenticated
 * API as a blob rather than pointed at a URL, so the element only ever gets an
 * object URL — and it is fetched lazily, on the first play or seek, because a
 * list of these would otherwise download every recording on mount.
 */
export function useVoiceNotePlayback(api: denizApi, voiceNote: IVoiceNote) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>();
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(voiceNote.durationMs ?? 0);

  useEffect(() => {
    setDurationMs(voiceNote.durationMs ?? 0);
  }, [voiceNote.durationMs]);

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  const ensureAudio = useCallback(async () => {
    if (audioUrl) return audioUrl;
    setLoadingAudio(true);
    const result = await api.GET_RAW({
      endpoint: `voice-notes/${voiceNote._id}/audio`,
    });
    setLoadingAudio(false);
    if ("code" in result) {
      toast.error(result.message);
      return undefined;
    }
    const url = URL.createObjectURL(await result.blob());
    setAudioUrl(url);
    return url;
  }, [api, audioUrl, voiceNote._id]);

  /** Attaches the blob on first use; returns the element once it can play. */
  const readyAudio = useCallback(async () => {
    const url = await ensureAudio();
    const audio = audioRef.current;
    if (!url || !audio) return null;
    if (!audio.src) {
      audio.src = url;
      audio.load();
    }
    return audio;
  }, [ensureAudio]);

  const togglePlayback = useCallback(async () => {
    const audio = await readyAudio();
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        toast.error("This audio format could not be played");
      }
    } else audio.pause();
  }, [readyAudio]);

  const seek = useCallback(
    async (seconds: number) => {
      const audio = await readyAudio();
      if (!audio) return;
      audio.currentTime = Math.max(
        0,
        Math.min(
          audio.duration || durationMs / 1_000,
          audio.currentTime + seconds,
        ),
      );
    },
    [durationMs, readyAudio],
  );

  const seekToFraction = useCallback(
    async (fraction: number) => {
      const audio = await readyAudio();
      if (!audio) return;
      audio.currentTime = fraction * (audio.duration || durationMs / 1_000);
    },
    [durationMs, readyAudio],
  );

  /** Spread onto the `<audio>` element the consumer renders. */
  const audioProps = {
    ref: audioRef,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: (event: React.SyntheticEvent<HTMLAudioElement>) =>
      setCurrentMs(event.currentTarget.currentTime * 1_000),
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLAudioElement>) => {
      if (Number.isFinite(event.currentTarget.duration)) {
        setDurationMs(event.currentTarget.duration * 1_000);
      }
    },
  };

  return {
    audioProps,
    playing,
    loadingAudio,
    currentMs,
    durationMs,
    progress: durationMs > 0 ? currentMs / durationMs : 0,
    togglePlayback,
    seek,
    seekToFraction,
  };
}
