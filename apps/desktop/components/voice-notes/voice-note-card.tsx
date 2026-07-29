"use client";

import type { INote, IVoiceNote } from "@repo/schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import {
  ChevronDown,
  Loader2,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useVoiceNotePlayback } from "@/hooks/use-voice-note-playback";
import type { denizApi } from "@/lib/api-wrapper";
import { GenerateNoteDialog } from "./generate-note-dialog";
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
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(voiceNote.title);
  const waveform = useMemo(
    () =>
      voiceNote.waveform.length > 4
        ? voiceNote.waveform
        : fallbackWaveform(voiceNote._id),
    [voiceNote._id, voiceNote.waveform],
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

  const commitTitle = useCallback(async () => {
    const title = titleDraft.trim().slice(0, 300);
    setEditingTitle(false);
    if (!title || title === voiceNote.title) return;
    const previous = voiceNote.title;
    onChanged?.({ ...voiceNote, title, titleSource: "manual" });
    const result = await api.PATCH<{ voiceNote: IVoiceNote }>({
      endpoint: `voice-notes/${voiceNote._id}`,
      body: { title },
    });
    if ("code" in result) {
      onChanged?.({ ...voiceNote, title: previous });
      setTitleDraft(previous);
      toast.error(result.message);
      return;
    }
    onChanged?.(result.voiceNote);
  }, [api, onChanged, titleDraft, voiceNote]);

  const deleteVoiceNote = useCallback(async () => {
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
      <audio {...audioProps} />

      <div className={compact ? "p-2.5" : "p-4"}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <input
                // biome-ignore lint/a11y/noAutofocus: replaces the title the owner just clicked
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void commitTitle()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void commitTitle();
                  }
                  if (event.key === "Escape") {
                    setTitleDraft(voiceNote.title);
                    setEditingTitle(false);
                  }
                }}
                maxLength={300}
                className="w-full bg-transparent text-xs font-medium outline-none"
                aria-label="Voice note title"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(voiceNote.title);
                  setEditingTitle(true);
                }}
                className="block w-full truncate text-left text-xs font-medium hover:text-muted-foreground"
                title="Rename"
              >
                {voiceNote.title}
              </button>
            )}
            <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
              {timestamp(voiceNote.createdAt)} ·{" "}
              {statusLabel(voiceNote.transcription.status)}
            </p>
          </div>
          {!compact && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={deleting}
                  className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                  title="Delete voice note"
                >
                  {deleting ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Trash2 className="size-3" />
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="truncate">
                    Delete “{voiceNote.title}”?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    The audio, its transcript, and memories formed from it are
                    removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void deleteVoiceNote()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
              <GenerateNoteDialog
                api={api}
                voiceNote={voiceNote}
                onChanged={onChanged}
                onGenerated={onGenerated}
              />
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
