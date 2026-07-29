"use client";

import type { INote, IVoiceNote } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  ChevronDown,
  FilePlus2,
  Loader2,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import { formatDuration } from "./voice-recorder-provider";

interface VoiceNoteCardProps {
  api: denizApi;
  voiceNote: IVoiceNote;
  compact?: boolean;
  onChanged?: (voiceNote: IVoiceNote) => void;
  onDeleted?: (voiceNoteId: string) => void;
  onGenerated?: (note: INote) => void;
}

function timestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: IVoiceNote["transcription"]["status"]) {
  switch (status) {
    case "untranscribed":
      return "not transcribed";
    case "transcribing":
      return "transcribing";
    default:
      return status;
  }
}

function fallbackWaveform(id: string, count = 96) {
  let seed = [...id].reduce(
    (value, character) => value + character.charCodeAt(0),
    0,
  );
  return Array.from({ length: count }, (_, index) => {
    seed = (seed * 9301 + 49297 + index) % 233280;
    return 0.16 + (seed / 233280) * 0.7;
  });
}

export function VoiceNoteCard({
  api,
  voiceNote,
  compact = false,
  onChanged,
  onDeleted,
  onGenerated,
}: VoiceNoteCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>();
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(voiceNote.durationMs ?? 0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const waveform = useMemo(
    () =>
      voiceNote.waveform.length > 4
        ? voiceNote.waveform
        : fallbackWaveform(voiceNote._id),
    [voiceNote._id, voiceNote.waveform],
  );
  const progress = durationMs > 0 ? currentMs / durationMs : 0;

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

  const togglePlayback = useCallback(async () => {
    const url = await ensureAudio();
    if (!url) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.src) {
      audio.src = url;
      audio.load();
    }
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        toast.error("This audio format could not be played");
      }
    } else audio.pause();
  }, [ensureAudio]);

  const seek = useCallback(
    async (seconds: number) => {
      const url = await ensureAudio();
      if (!url || !audioRef.current) return;
      if (!audioRef.current.src) {
        audioRef.current.src = url;
        audioRef.current.load();
      }
      audioRef.current.currentTime = Math.max(
        0,
        Math.min(
          audioRef.current.duration || durationMs / 1_000,
          audioRef.current.currentTime + seconds,
        ),
      );
    },
    [durationMs, ensureAudio],
  );

  const seekToFraction = useCallback(
    async (fraction: number) => {
      const url = await ensureAudio();
      if (!url || !audioRef.current) return;
      if (!audioRef.current.src) {
        audioRef.current.src = url;
        audioRef.current.load();
      }
      audioRef.current.currentTime =
        fraction * (audioRef.current.duration || durationMs / 1_000);
    },
    [durationMs, ensureAudio],
  );

  const transcribe = useCallback(async () => {
    setTranscribing(true);
    const result = await api.POST<{
      queued: boolean;
      voiceNote: IVoiceNote;
    }>({
      endpoint: `voice-notes/${voiceNote._id}/transcribe`,
      body: { force: voiceNote.transcription.status === "failed" },
    });
    setTranscribing(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    onChanged?.(result.voiceNote);
    toast.success(result.queued ? "Transcription queued" : "Already queued");
  }, [api, onChanged, voiceNote._id, voiceNote.transcription.status]);

  const generateNote = useCallback(async () => {
    setGenerating(true);
    const result = await api.POST<{
      note: INote;
      voiceNote: IVoiceNote;
    }>({
      endpoint: `voice-notes/${voiceNote._id}/generate-note`,
      body: {},
    });
    setGenerating(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    onChanged?.(result.voiceNote);
    onGenerated?.(result.note);
    toast.success("Note generated");
  }, [api, onChanged, onGenerated, voiceNote._id]);

  const deleteVoiceNote = useCallback(async () => {
    if (!window.confirm(`Delete “${voiceNote.title}”?`)) return;
    setDeleting(true);
    const result = await api.DELETE<{ success: true }>({
      endpoint: `voice-notes/${voiceNote._id}`,
    });
    setDeleting(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    onDeleted?.(voiceNote._id);
    window.dispatchEvent(new CustomEvent("voice-notes:changed"));
  }, [api, onDeleted, voiceNote._id, voiceNote.title]);

  return (
    <article className="group border bg-background">
      {/* The complete transcript is rendered beside this control when available. */}
      {/* biome-ignore lint/a11y/useMediaCaption: generated transcript is not a timed VTT track */}
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

      <div className={compact ? "p-2.5" : "p-4"}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-xs font-medium">{voiceNote.title}</h3>
            <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
              {timestamp(voiceNote.createdAt)} ·{" "}
              {statusLabel(voiceNote.transcription.status)}
            </p>
          </div>
          {!compact && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={deleting}
              onClick={() => void deleteVoiceNote()}
              className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
              title="Delete voice note"
            >
              {deleting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
            </Button>
          )}
        </div>

        <div
          className="relative flex h-16 cursor-pointer items-center gap-[2px] overflow-hidden bg-muted/25 px-2"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            void seekToFraction((event.clientX - bounds.left) / bounds.width);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void togglePlayback();
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              void seek(-5);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              void seek(5);
            }
          }}
          role="slider"
          tabIndex={0}
          aria-label="Audio position"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs)}
          aria-valuenow={Math.round(currentMs)}
        >
          {waveform.map((sample, index) => {
            const played = index / waveform.length <= progress;
            return (
              <span
                key={`${index}-${sample}`}
                className={
                  played
                    ? "min-w-px flex-1 bg-foreground"
                    : "min-w-px flex-1 bg-muted-foreground/35"
                }
                style={{ height: `${Math.max(8, sample * 92)}%` }}
              />
            );
          })}
          <span
            className="pointer-events-none absolute inset-y-0 w-px bg-red-500"
            style={{ left: `${progress * 100}%` }}
          />
        </div>

        <div className="mt-2 flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="relative size-7"
            onClick={() => void togglePlayback()}
            disabled={loadingAudio}
            title={playing ? "Pause" : "Play"}
          >
            {loadingAudio ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : playing ? (
              <Pause className="size-3.5 fill-current" />
            ) : (
              <Play className="size-3.5 fill-current" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="relative size-7"
            onClick={() => void seek(-15)}
            title="Back 15 seconds"
          >
            <RotateCcw className="size-3.5" />
            <span className="absolute text-[6px] font-semibold">15</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="relative size-7"
            onClick={() => void seek(15)}
            title="Forward 15 seconds"
          >
            <RotateCw className="size-3.5" />
            <span className="absolute text-[6px] font-semibold">15</span>
          </Button>
          <span className="ml-1 font-mono text-[10px] tabular-nums text-muted-foreground">
            {formatDuration(currentMs)} / {formatDuration(durationMs)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {voiceNote.transcription.status === "transcribed" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[10px]"
                disabled={generating}
                onClick={() => void generateNote()}
              >
                {generating ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <FilePlus2 className="size-3" />
                )}
                Note
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[10px]"
                disabled={
                  transcribing ||
                  voiceNote.transcription.status === "queued" ||
                  voiceNote.transcription.status === "transcribing"
                }
                onClick={() => void transcribe()}
              >
                {transcribing ||
                voiceNote.transcription.status === "queued" ||
                voiceNote.transcription.status === "transcribing" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCcw className="size-3" />
                )}
                Transcribe
              </Button>
            )}
          </div>
        </div>
      </div>

      {voiceNote.transcription.text && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => setTranscriptOpen((open) => !open)}
            className="flex w-full items-center justify-between px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-muted/30"
          >
            Transcript
            <ChevronDown
              className={`size-3 transition-transform ${transcriptOpen ? "rotate-180" : ""}`}
            />
          </button>
          {transcriptOpen && (
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {voiceNote.transcription.text}
            </p>
          )}
        </div>
      )}

      {voiceNote.transcription.error && (
        <p className="border-t px-4 py-2 text-[10px] text-destructive">
          {voiceNote.transcription.error}
        </p>
      )}
    </article>
  );
}
