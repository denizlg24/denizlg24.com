"use client";

import type { AgentMemoryGraphNode } from "@repo/schemas";
import { Info, Loader2, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdminClient } from "../client";

const BARS = 44;

function formatClock(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1_000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function resample(samples: number[]): number[] {
  if (samples.length === 0) return Array.from({ length: BARS }, () => 0.3);
  return Array.from(
    { length: BARS },
    (_, index) => samples[Math.floor((index / BARS) * samples.length)] ?? 0.3,
  );
}

/**
 * The one interactive node in the lattice. Sprites are textures and cannot hold
 * a play button, so the focused voice-note memory is mirrored by this DOM panel
 * positioned over its projected screen point. Exactly one is ever mounted: DOM
 * always paints above the WebGL canvas and therefore cannot be occluded by the
 * graph, which is tolerable for the node being looked at and would not be for
 * all of them.
 */
export function GraphVoicePlayer({
  client,
  node,
  left,
  top,
  scale,
  accent,
  onOpenDetails,
  onDismiss,
}: {
  client: AdminClient;
  node: AgentMemoryGraphNode;
  left: number;
  top: number;
  scale: number;
  accent: string;
  /** Opens the detail sheet, which the player deliberately does not do itself. */
  onOpenDetails: () => void;
  onDismiss: () => void;
}) {
  const voiceNote = node.voiceNote;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const loadingRef = useRef<Promise<string | null> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(voiceNote?.durationMs ?? 0);
  const bars = useMemo(() => resample(voiceNote?.waveform ?? []), [voiceNote]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  const ensureAudio = useCallback(async () => {
    if (urlRef.current) return urlRef.current;
    if (loadingRef.current) return loadingRef.current;
    if (!voiceNote) return null;
    setLoading(true);
    const pending = (async () => {
      try {
        const response = await client.raw(`voice-notes/${voiceNote.id}/audio`);
        const url = URL.createObjectURL(await response.blob());
        urlRef.current = url;
        return url;
      } catch {
        return null;
      } finally {
        setLoading(false);
        loadingRef.current = null;
      }
    })();
    loadingRef.current = pending;
    return pending;
  }, [client, voiceNote]);

  const toggle = useCallback(async () => {
    const url = await ensureAudio();
    const audio = audioRef.current;
    if (!url || !audio) return;
    if (!audio.src) {
      audio.src = url;
      audio.load();
    }
    if (audio.paused) await audio.play().catch(() => undefined);
    else audio.pause();
  }, [ensureAudio]);

  const seekToFraction = useCallback(
    async (fraction: number) => {
      const url = await ensureAudio();
      const audio = audioRef.current;
      if (!url || !audio) return;
      if (!audio.src) {
        audio.src = url;
        audio.load();
      }
      audio.currentTime =
        Math.min(1, Math.max(0, fraction)) *
        (audio.duration || durationMs / 1_000);
    },
    [durationMs, ensureAudio],
  );

  if (!voiceNote) return null;
  const progress = durationMs > 0 ? currentMs / durationMs : 0;
  const percent = Math.round(progress * 100);

  return (
    <div
      className="pointer-events-auto absolute z-10 flex items-center gap-2 rounded-full border bg-background/95 px-1 py-1 shadow-lg backdrop-blur"
      style={{
        left,
        top,
        width: 300,
        transform: `translate(-50%, -50%) scale(${scale})`,
        borderColor: accent,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: a transcript is not a timed track */}
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) =>
          setCurrentMs(event.currentTarget.currentTime * 1_000)
        }
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) {
            setDurationMs(event.currentTarget.duration * 1_000);
          }
        }}
      />
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={playing ? "Pause" : "Play"}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : playing ? (
          <Pause className="size-3.5" />
        ) : (
          <Play className="size-3.5" />
        )}
      </button>

      <button
        type="button"
        role="slider"
        aria-label={`Seek ${voiceNote.title}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${formatClock(currentMs)} of ${formatClock(durationMs)}`}
        className="flex h-6 min-w-0 flex-1 items-center gap-px"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          void seekToFraction((event.clientX - bounds.left) / bounds.width);
        }}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? -0.05
              : event.key === "ArrowRight" || event.key === "ArrowUp"
                ? 0.05
                : event.key === "Home"
                  ? -1
                  : event.key === "End"
                    ? 1
                    : 0;
          if (step === 0) return;
          event.preventDefault();
          void seekToFraction(
            step === -1 ? 0 : step === 1 ? 1 : progress + step,
          );
        }}
      >
        {bars.map((level, index) => (
          <span
            key={index}
            className="w-full rounded-full"
            style={{
              height: `${Math.max(12, level * 100)}%`,
              backgroundColor: accent,
              opacity: index / BARS <= progress ? 0.9 : 0.3,
            }}
          />
        ))}
      </button>

      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatClock(currentMs)}/{formatClock(durationMs)}
      </span>

      <button
        type="button"
        onClick={onOpenDetails}
        aria-label="Open memory detail"
        title="Open memory detail"
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Info className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Close player"
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
