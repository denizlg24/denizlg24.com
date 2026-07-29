"use client";

import type { IVoiceNote } from "@repo/schemas";
import { Loader2, Pause, Play, X } from "lucide-react";
import { useMemo } from "react";
import { useVoiceNotePlayback } from "@/hooks/use-voice-note-playback";
import type { denizApi } from "@/lib/api-wrapper";
import { formatDuration } from "./voice-recorder-provider";

const BARS = 32;

/** Even sampling of the stored waveform down to the bar count. */
function miniWaveform(samples: number[], id: string) {
  if (samples.length < 4) {
    let seed = [...id].reduce((total, char) => total + char.charCodeAt(0), 0);
    return Array.from({ length: BARS }, (_, index) => {
      seed = (seed * 9301 + 49297 + index) % 233280;
      return 0.2 + (seed / 233280) * 0.65;
    });
  }
  const stride = samples.length / BARS;
  return Array.from({ length: BARS }, (_, index) =>
    Math.max(
      ...samples.slice(
        Math.floor(index * stride),
        Math.max(
          Math.floor(index * stride) + 1,
          Math.floor((index + 1) * stride),
        ),
      ),
    ),
  );
}

/**
 * One linked voice note, sized to sit inline beneath a note's fields. The full
 * card belongs on the voice-notes page; here the recording is an attachment,
 * so this shows only what it takes to recognise and play it.
 */
export function VoiceNoteBar({
  api,
  voiceNote,
  onDetach,
}: {
  api: denizApi;
  voiceNote: IVoiceNote;
  onDetach?: () => void;
}) {
  const {
    audioProps,
    playing,
    loadingAudio,
    currentMs,
    durationMs,
    progress,
    togglePlayback,
    seek,
    seekToFraction,
  } = useVoiceNotePlayback(api, voiceNote);
  const bars = useMemo(
    () => miniWaveform(voiceNote.waveform, voiceNote._id),
    [voiceNote._id, voiceNote.waveform],
  );
  const pending = ["queued", "transcribing"].includes(
    voiceNote.transcription.status,
  );

  return (
    <div className="group/bar flex h-9 items-center gap-2 rounded-full border bg-muted/20 pr-2 pl-1">
      <audio {...audioProps} />
      <button
        type="button"
        onClick={() => void togglePlayback()}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-surface"
        aria-label={playing ? "Pause" : "Play"}
      >
        {loadingAudio ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : playing ? (
          <Pause className="size-3.5" />
        ) : (
          <Play className="size-3.5" />
        )}
      </button>

      <span className="min-w-0 max-w-40 shrink truncate text-[11px]">
        {voiceNote.title}
      </span>

      <button
        type="button"
        role="slider"
        tabIndex={0}
        aria-label="Audio position"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs)}
        aria-valuenow={Math.round(currentMs)}
        className="flex h-5 min-w-16 flex-1 items-center gap-px"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          void seekToFraction((event.clientX - bounds.left) / bounds.width);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void togglePlayback();
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            void seek(-5);
          } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            void seek(5);
          } else if (event.key === "Home") {
            event.preventDefault();
            void seekToFraction(0);
          } else if (event.key === "End") {
            event.preventDefault();
            void seekToFraction(1);
          }
        }}
      >
        {bars.map((level, index) => (
          <span
            key={index}
            className={`w-full rounded-full transition-colors ${
              index / BARS <= progress ? "bg-foreground/70" : "bg-foreground/20"
            }`}
            style={{ height: `${Math.max(12, level * 100)}%` }}
          />
        ))}
      </button>

      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatDuration(currentMs)}/{formatDuration(durationMs)}
      </span>

      {pending && (
        <Loader2
          className="size-3 shrink-0 animate-spin text-muted-foreground"
          aria-label="Transcribing"
        />
      )}

      {onDetach && (
        <button
          type="button"
          onClick={onDetach}
          aria-label={`Detach ${voiceNote.title}`}
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/bar:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
