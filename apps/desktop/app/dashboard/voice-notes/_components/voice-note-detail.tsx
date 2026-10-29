"use client";

import type {
  IVoiceNote,
  IVoiceNoteSummary,
  VoiceNoteContextCandidate,
  VoiceNoteUpdateInput,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { Meter } from "@repo/ui/meter";
import { PageTitle } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { RowActions } from "@repo/ui/toolbar";
import {
  AudioLines,
  CalendarClock,
  Clock,
  FileText,
  Folder,
  Hash,
  Loader2,
  MapPin,
  Mic,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  formatBytes,
  formatDateTime,
  formatSpan,
} from "@/components/voice-notes/format";
import { GenerateNoteDialog } from "@/components/voice-notes/generate-note-dialog";
import { formatDuration } from "@/components/voice-notes/voice-recorder-provider";
import { useVoiceNotePlayback } from "@/hooks/use-voice-note-playback";
import type { denizApi } from "@/lib/api-wrapper";
import { isPending } from "./use-voice-note-list";
import {
  type ContextChoice,
  VoiceNoteContextPicker,
} from "./voice-note-context-picker";
import { VoiceNotePlayer } from "./voice-note-player";
import { VoiceNoteTagEditor } from "./voice-note-tag-editor";
import { VoiceNoteTranscript } from "./voice-note-transcript";
import { ContextDot } from "./voice-notes-primitives";
import {
  VoiceNoteDetailSkeleton,
  VoiceNoteTranscriptSkeleton,
} from "./voice-notes-skeletons";

const POLL_INTERVAL_MS = 5_000;

type LoadState = "loading" | "ready" | "missing";

function TranscriptionState({
  voiceNote,
  busy,
  onTranscribe,
}: {
  voiceNote: IVoiceNoteSummary;
  busy: boolean;
  onTranscribe: (force: boolean) => void;
}) {
  const { status, progress, error } = voiceNote.transcription;

  if (status === "untranscribed") {
    return (
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onTranscribe(false)}
        >
          {busy ? <Loader2 className="animate-spin" /> : <AudioLines />}
          Transcribe
        </Button>
      </div>
    );
  }

  if (status === "queued" || status === "transcribing") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {status}
          {progress && progress.total > 0 && (
            <span className="text-accent-strong">
              {progress.completed}/{progress.total}
            </span>
          )}
        </div>
        {progress && progress.total > 0 && (
          <Meter value={progress.completed / progress.total} />
        )}
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex items-start gap-2">
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive" />
        <p className="min-w-0 flex-1 text-xs break-words text-destructive">
          {error ?? "failed"}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={busy}
          onClick={() => onTranscribe(true)}
        >
          {busy ? <Loader2 className="animate-spin" /> : <RotateCw />}
          Retry
        </Button>
      </div>
    );
  }

  return null;
}

export function VoiceNoteDetail({
  api,
  voiceNoteId,
  summary,
  terms,
  matchStartSecond,
  tagSuggestions,
  onChanged,
  onTaxonomyChanged,
  onDeleted,
  onClose,
}: {
  api: denizApi;
  voiceNoteId: string;
  /** The list row, so the header renders before the full note arrives. */
  summary?: IVoiceNoteSummary;
  terms: readonly string[];
  matchStartSecond?: number;
  tagSuggestions: string[];
  onChanged: (voiceNote: IVoiceNote) => void;
  onTaxonomyChanged: () => void;
  onDeleted: (voiceNoteId: string) => void;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState<IVoiceNote | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [transcribing, setTranscribing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const loadedRef = useRef(false);
  // WebView2 fires blur when the focused input unmounts after Escape, with the
  // edited draft still in that handler's closure.
  const titleCancelledRef = useRef(false);
  const view = note ?? summary;
  const playback = useVoiceNotePlayback(api, {
    _id: voiceNoteId,
    durationMs: view?.durationMs,
  });

  const load = useCallback(async () => {
    const result = await api.GET<{ voiceNote: IVoiceNote }>({
      endpoint: `voice-notes/${voiceNoteId}`,
    });
    if ("code" in result) {
      if (result.code === 404) setLoadState("missing");
      else if (!loadedRef.current) toast.error(result.message);
      return;
    }
    loadedRef.current = true;
    setNote(result.voiceNote);
    setLoadState("ready");
    onChanged(result.voiceNote);
  }, [api, onChanged, voiceNoteId]);

  useEffect(() => {
    void load();
    const handleChanged = () => void load();
    window.addEventListener("voice-notes:changed", handleChanged);
    return () =>
      window.removeEventListener("voice-notes:changed", handleChanged);
  }, [load]);

  const pending = note ? isPending(note) : false;
  useEffect(() => {
    if (!pending) return;
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load, pending]);

  // A bulk action or the list's own poll can move the row past what this pane
  // last read; refetch rather than show a stale transcription state.
  const summaryUpdatedAt = summary?.updatedAt;
  useEffect(() => {
    if (!note || !summaryUpdatedAt) return;
    if (Date.parse(summaryUpdatedAt) > Date.parse(note.updatedAt)) void load();
  }, [summaryUpdatedAt]);

  const patch = async (
    body: VoiceNoteUpdateInput,
    optimistic: (current: IVoiceNote) => IVoiceNote,
  ) => {
    if (!note) return false;
    const previous = note;
    const next = optimistic(previous);
    setNote(next);
    onChanged(next);
    const result = await api.PATCH<{ voiceNote: IVoiceNote }>({
      endpoint: `voice-notes/${voiceNoteId}`,
      body,
    });
    if ("code" in result) {
      setNote(previous);
      onChanged(previous);
      toast.error(result.message);
      return false;
    }
    setNote(result.voiceNote);
    onChanged(result.voiceNote);
    return true;
  };

  const commitTitle = async () => {
    setEditingTitle(false);
    if (titleCancelledRef.current) return;
    const title = titleDraft.trim().slice(0, 300);
    if (!note || !title || title === note.title) return;
    await patch({ title }, (current) => ({
      ...current,
      title,
      titleSource: "manual",
    }));
  };

  const changeTags = async (tags: string[]) => {
    const saved = await patch({ tags }, (current) => ({ ...current, tags }));
    if (saved) onTaxonomyChanged();
  };

  const chooseContext = async (
    choice: ContextChoice,
    candidate?: VoiceNoteContextCandidate,
  ) => {
    const saved = await patch({ context: choice }, (current) => {
      if (choice === null) {
        return { ...current, context: undefined, contextSource: "manual" };
      }
      if (choice === "auto" || !candidate) return current;
      const { overlapMs, ...context } = candidate;
      return { ...current, context, contextSource: "manual" };
    });
    if (saved) onTaxonomyChanged();
  };

  const transcribe = async (force: boolean) => {
    setTranscribing(true);
    const result = await api.POST<{ queued: boolean; voiceNote: IVoiceNote }>({
      endpoint: `voice-notes/${voiceNoteId}/transcribe`,
      body: { force },
    });
    setTranscribing(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    setNote(result.voiceNote);
    onChanged(result.voiceNote);
  };

  const remove = async () => {
    setDeleting(true);
    const result = await api.DELETE<{ success: true }>({
      endpoint: `voice-notes/${voiceNoteId}`,
    });
    setDeleting(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    onDeleted(voiceNoteId);
  };

  if (loadState === "missing") {
    return <EmptyState icon={<Mic />} label="Not found" />;
  }

  if (!view) return <VoiceNoteDetailSkeleton />;

  const { transcription } = view;
  const segmentCount = note?.transcription.segments?.length ?? 0;
  const transcriptMeta = [transcription.model, transcription.language]
    .filter(Boolean)
    .join(" · ");

  const titleNode = editingTitle ? (
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
        } else if (event.key === "Escape") {
          event.preventDefault();
          titleCancelledRef.current = true;
          setEditingTitle(false);
        }
      }}
      maxLength={300}
      aria-label="Voice note title"
      className="w-full min-w-0 bg-transparent outline-none"
    />
  ) : (
    <button
      type="button"
      disabled={!note}
      onClick={() => {
        titleCancelledRef.current = false;
        setTitleDraft(view.title);
        setEditingTitle(true);
      }}
      className="-mx-1 rounded px-1 text-left break-words hover:bg-surface/70 disabled:hover:bg-transparent"
      aria-label={`Rename ${view.title}`}
    >
      {view.title}
    </button>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 pt-6 sm:px-8">
        <PageTitle
          title={titleNode}
          actions={
            <>
              {note && transcription.status === "transcribed" && (
                <GenerateNoteDialog
                  api={api}
                  voiceNote={note}
                  onChanged={(next) => {
                    setNote(next);
                    onChanged(next);
                  }}
                  onGenerated={(generated) =>
                    router.push(
                      `/dashboard/notes?note=${encodeURIComponent(generated._id)}`,
                    )
                  }
                />
              )}
              {note ? (
                <RowActions>
                  {transcription.status === "transcribed" && (
                    <DropdownMenuItem
                      disabled={transcribing}
                      onSelect={() => void transcribe(true)}
                    >
                      <RotateCw />
                      Re-transcribe
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={deleting}
                    onSelect={() => setConfirmDelete(true)}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </RowActions>
              ) : null}
              {onClose && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <X />
                </Button>
              )}
            </>
          }
        />

        <Properties>
          <Property icon={<CalendarClock />} label="Recorded">
            <span className="tabular-nums">
              {formatDateTime(view.recordedAt)}
            </span>
          </Property>
          <Property icon={<Clock />} label="Duration">
            <span className="tabular-nums">
              {view.durationMs ? formatDuration(view.durationMs) : "—"}
              <span className="ml-2 text-xs text-muted-foreground">
                {formatBytes(view.sizeBytes)} · {view.source}
              </span>
            </span>
          </Property>
          <Property icon={<MapPin />} label="Context">
            <VoiceNoteContextPicker
              api={api}
              voiceNote={view}
              disabled={!note}
              onChoose={chooseContext}
            />
          </Property>
          <Property icon={<Hash />} label="Tags">
            <VoiceNoteTagEditor
              tags={view.tags}
              suggestions={tagSuggestions}
              disabled={!note}
              onChange={(tags) => void changeTags(tags)}
            />
          </Property>
          {!note && view.noteIds.length > 0 && (
            <Property icon={<FileText />} label="Notes">
              <Skeleton className="h-3 w-40" />
            </Property>
          )}
          {note && note.linkedNotes.length > 0 && (
            <Property icon={<FileText />} label="Notes">
              <div className="flex flex-col py-1">
                {note.linkedNotes.map((linked) => (
                  <button
                    key={linked._id}
                    type="button"
                    onClick={() =>
                      router.push(
                        `/dashboard/notes?note=${encodeURIComponent(linked._id)}`,
                      )
                    }
                    className="-mx-1.5 max-w-full truncate rounded-md px-1.5 py-0.5 text-left hover:bg-surface/70"
                  >
                    {linked.title}
                  </button>
                ))}
              </div>
            </Property>
          )}
          {view.groups.length > 0 && (
            <Property icon={<Folder />} label="Groups">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {view.groups.map((group) => (
                  <span key={group._id} className="flex items-center gap-1.5">
                    <ContextDot color={group.color} />
                    {group.name}
                  </span>
                ))}
              </div>
            </Property>
          )}
        </Properties>
      </div>

      <div className="sticky top-0 z-20 mt-6 border-y bg-background/95 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-3xl px-5 pt-5 pb-2 sm:px-8">
          <VoiceNotePlayer
            voiceNoteId={voiceNoteId}
            waveform={view.waveform}
            playback={playback}
          />
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-5 pt-6 pb-10 sm:px-8">
        <Section
          title="Transcript"
          count={
            segmentCount > 1
              ? `${segmentCount} · ${formatSpan(view.durationMs ?? 0)}`
              : undefined
          }
          actions={
            transcriptMeta ? (
              <span className="text-xs text-muted-foreground">
                {transcriptMeta}
              </span>
            ) : undefined
          }
        >
          <TranscriptionState
            voiceNote={view}
            busy={transcribing}
            onTranscribe={(force) => void transcribe(force)}
          />
          {note ? (
            <VoiceNoteTranscript
              transcription={note.transcription}
              durationMs={playback.durationMs}
              currentMs={playback.currentMs}
              terms={terms}
              matchStartSecond={matchStartSecond}
              onSeek={(milliseconds) => {
                void playback.seekToMs(milliseconds).then(playback.play);
              }}
            />
          ) : (
            <VoiceNoteTranscriptSkeleton />
          )}
        </Section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${view.title}”?`}
        description={`${formatDateTime(view.recordedAt)} · ${
          view.durationMs ? formatDuration(view.durationMs) : "—"
        } · ${formatBytes(view.sizeBytes)}`}
        actionLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}
