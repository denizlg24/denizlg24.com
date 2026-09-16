"use client";

import type { IVoiceNoteSummary } from "@repo/schemas";
import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";

export const PLAYBACK_RATES: readonly number[] = [1, 1.25, 1.5, 2];

type PlayableVoiceNote = Pick<IVoiceNoteSummary, "_id" | "durationMs">;

/**
 * Setting `currentTime` before metadata has loaded is dropped by WebKit, so a
 * seek on a note that has never played would silently start from zero.
 */
function whenSeekable(audio: HTMLAudioElement) {
  if (audio.error || audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const done = () => {
      audio.removeEventListener("loadedmetadata", done);
      audio.removeEventListener("error", done);
      resolve();
    };
    audio.addEventListener("loadedmetadata", done);
    audio.addEventListener("error", done);
  });
}

/**
 * Playback for one voice note. The audio is fetched through the authenticated
 * API as a blob rather than pointed at a URL, so the element only ever gets an
 * object URL — and it is fetched lazily, on the first play or seek, because a
 * list of these would otherwise download every recording on mount.
 *
 * Callers key the component using this by note id: the hook does not reset
 * itself when handed a different note.
 */
export function useVoiceNotePlayback(
  api: denizApi,
  voiceNote: PlayableVoiceNote,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>();
  const [loadingAudio, setLoadingAudio] = useState(false);
  const loadingRef = useRef<Promise<string | undefined> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(voiceNote.durationMs ?? 0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);

  useEffect(() => {
    setDurationMs(voiceNote.durationMs ?? 0);
  }, [voiceNote.durationMs]);

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  // `load()` resets `playbackRate` to `defaultPlaybackRate`, so both are set
  // for the chosen speed to survive the lazy attach.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.defaultPlaybackRate = playbackRate;
    audio.playbackRate = playbackRate;
  }, [playbackRate]);

  const ensureAudio = useCallback(async () => {
    if (audioUrl) return audioUrl;
    // Play and seek both call this, and a click on the waveform does both.
    // Without sharing the in-flight request each one downloads the file and
    // mints its own object URL, and every URL but the last leaks.
    if (loadingRef.current) return loadingRef.current;

    setLoadingAudio(true);
    const pending = (async () => {
      try {
        const result = await api.GET_RAW({
          endpoint: `voice-notes/${voiceNote._id}/audio`,
        });
        if ("code" in result) {
          toast.error(result.message);
          return undefined;
        }
        const url = URL.createObjectURL(await result.blob());
        setAudioUrl(url);
        return url;
      } finally {
        setLoadingAudio(false);
        loadingRef.current = null;
      }
    })();
    loadingRef.current = pending;
    return pending;
  }, [api, audioUrl, voiceNote._id]);

  /**
   * Attaches the blob on first use; returns the element once it can seek. The
   * element's `src` is checked before state because a caller chaining two
   * actions (seek, then play) holds a closure from before the URL existed.
   */
  const readyAudio = useCallback(async () => {
    const attached = audioRef.current;
    if (attached?.src) {
      await whenSeekable(attached);
      return attached;
    }
    const url = await ensureAudio();
    const audio = audioRef.current;
    if (!url || !audio) return null;
    if (!audio.src) {
      audio.src = url;
      audio.load();
    }
    await whenSeekable(audio);
    return audio;
  }, [ensureAudio]);

  /** Recordings from MediaRecorder report `Infinity` until fully scanned. */
  const knownDurationSeconds = useCallback(
    (audio: HTMLAudioElement) =>
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : durationMs / 1_000,
    [durationMs],
  );

  const setPosition = useCallback(
    (audio: HTMLAudioElement, seconds: number) => {
      const limit = knownDurationSeconds(audio);
      const next = Math.max(0, limit > 0 ? Math.min(limit, seconds) : seconds);
      audio.currentTime = next;
      setCurrentMs(next * 1_000);
    },
    [knownDurationSeconds],
  );

  const play = useCallback(async () => {
    const audio = await readyAudio();
    if (!audio?.paused) return;
    try {
      await audio.play();
    } catch {
      toast.error("This audio format could not be played");
    }
  }, [readyAudio]);

  const togglePlayback = useCallback(async () => {
    const audio = await readyAudio();
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      toast.error("This audio format could not be played");
    }
  }, [readyAudio]);

  const seek = useCallback(
    async (seconds: number) => {
      const audio = await readyAudio();
      if (!audio) return;
      setPosition(audio, audio.currentTime + seconds);
    },
    [readyAudio, setPosition],
  );

  const seekToFraction = useCallback(
    async (fraction: number) => {
      const audio = await readyAudio();
      if (!audio) return;
      const clamped = Math.max(0, Math.min(1, fraction));
      setPosition(audio, clamped * knownDurationSeconds(audio));
    },
    [knownDurationSeconds, readyAudio, setPosition],
  );

  const seekToMs = useCallback(
    async (milliseconds: number) => {
      const audio = await readyAudio();
      if (!audio) return;
      setPosition(audio, milliseconds / 1_000);
    },
    [readyAudio, setPosition],
  );

  /** Spread onto the `<audio>` element the consumer renders. */
  const audioProps = {
    ref: audioRef,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: (event: SyntheticEvent<HTMLAudioElement>) =>
      setCurrentMs(event.currentTarget.currentTime * 1_000),
    onLoadedMetadata: (event: SyntheticEvent<HTMLAudioElement>) => {
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
    progress: durationMs > 0 ? Math.min(1, currentMs / durationMs) : 0,
    playbackRate,
    setPlaybackRate,
    play,
    togglePlayback,
    seek,
    seekToFraction,
    seekToMs,
  };
}

export type VoiceNotePlayback = ReturnType<typeof useVoiceNotePlayback>;
