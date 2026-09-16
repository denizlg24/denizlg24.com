"use client";

import { Loader2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { useState } from "react";
import { formatClock } from "@/components/voice-notes/format";
import {
  PLAYBACK_RATES,
  type VoiceNotePlayback,
} from "@/hooks/use-voice-note-playback";
import { cn } from "@/lib/utils";

function placeholderWaveform(id: string, count = 120) {
  let seed = [...id].reduce(
    (value, character) => value + character.charCodeAt(0),
    0,
  );
  return Array.from({ length: count }, (_, index) => {
    seed = (seed * 9301 + 49297 + index) % 233280;
    return 0.12 + (seed / 233280) * 0.5;
  });
}

function nextRate(current: number) {
  const index = PLAYBACK_RATES.indexOf(current);
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length];
}

function SkipButton({
  seconds,
  onClick,
}: {
  seconds: number;
  onClick: () => void;
}) {
  const Icon = seconds < 0 ? RotateCcw : RotateCw;
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={seconds < 0 ? "Back 15 seconds" : "Forward 15 seconds"}
    >
      <Icon className="size-4" />
      <span className="absolute font-mono text-[6px] font-semibold">
        {Math.abs(seconds)}
      </span>
    </button>
  );
}

export function VoiceNotePlayer({
  voiceNoteId,
  waveform,
  playback,
}: {
  voiceNoteId: string;
  waveform: number[];
  playback: VoiceNotePlayback;
}) {
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);
  const samples =
    waveform.length > 4 ? waveform : placeholderWaveform(voiceNoteId);
  const { durationMs, currentMs, progress } = playback;
  const withHours = durationMs >= 3_600_000;

  return (
    <div className="flex flex-col gap-1.5">
      <audio {...playback.audioProps} />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Audio position"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1_000)}
        aria-valuenow={Math.round(currentMs / 1_000)}
        aria-valuetext={formatClock(currentMs / 1_000, withHours)}
        className="relative flex h-14 cursor-pointer items-center gap-px rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          void playback.seekToFraction(
            (event.clientX - bounds.left) / bounds.width,
          );
        }}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setHoverFraction(
            Math.max(
              0,
              Math.min(1, (event.clientX - bounds.left) / bounds.width),
            ),
          );
        }}
        onMouseLeave={() => setHoverFraction(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void playback.togglePlayback();
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            void playback.seek(-5);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            void playback.seek(5);
          } else if (event.key === "Home") {
            event.preventDefault();
            void playback.seekToFraction(0);
          } else if (event.key === "End") {
            event.preventDefault();
            void playback.seekToFraction(1);
          }
        }}
      >
        {samples.map((sample, index) => (
          <span
            key={index}
            className={cn(
              "min-w-px flex-1 rounded-[1px] transition-colors",
              (index + 0.5) / samples.length <= progress
                ? "bg-foreground/80"
                : "bg-muted-foreground/30",
            )}
            style={{ height: `${Math.max(6, sample * 100)}%` }}
          />
        ))}
        {progress > 0 && (
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-red-500"
            style={{ left: `${progress * 100}%` }}
          />
        )}
        {hoverFraction !== null && durationMs > 0 && (
          <>
            <span
              className="pointer-events-none absolute inset-y-0 w-px bg-foreground/40"
              style={{ left: `${hoverFraction * 100}%` }}
            />
            <span
              className="pointer-events-none absolute -top-4 -translate-x-1/2 rounded-sm bg-popover px-1 font-mono text-[10px] tabular-nums shadow-sm"
              style={{ left: `${hoverFraction * 100}%` }}
            >
              {formatClock((hoverFraction * durationMs) / 1_000, withHours)}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <SkipButton seconds={-15} onClick={() => void playback.seek(-15)} />
        <button
          type="button"
          onClick={() => void playback.togglePlayback()}
          disabled={playback.loadingAudio}
          className="flex size-8 items-center justify-center rounded-full bg-foreground text-background hover:bg-foreground/85 disabled:opacity-60"
          aria-label={playback.playing ? "Pause" : "Play"}
        >
          {playback.loadingAudio ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : playback.playing ? (
            <Pause className="size-3.5 fill-current" />
          ) : (
            <Play className="size-3.5 translate-x-px fill-current" />
          )}
        </button>
        <SkipButton seconds={15} onClick={() => void playback.seek(15)} />
        <button
          type="button"
          onClick={() =>
            playback.setPlaybackRate(nextRate(playback.playbackRate))
          }
          className={cn(
            "ml-1 h-6 min-w-10 rounded-md px-1.5 font-mono text-[11px] tabular-nums hover:bg-muted",
            playback.playbackRate === 1
              ? "text-muted-foreground"
              : "text-foreground",
          )}
          aria-label={`Playback speed ${playback.playbackRate}×`}
        >
          {playback.playbackRate}×
        </button>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          <span className="text-foreground">
            {formatClock(currentMs / 1_000, withHours)}
          </span>{" "}
          / {formatClock(durationMs / 1_000, withHours)}
        </span>
      </div>
    </div>
  );
}
