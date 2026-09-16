"use client";

import type {
  IVoiceNote,
  IVoiceNoteSummary,
  VoiceNoteContextCandidate,
  VoiceNoteUpdateInput,
} from "@repo/schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Skeleton } from "@repo/ui/skeleton";
import {
  AudioLines,
  FileText,
  Loader2,
  MoreHorizontal,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { ContextDot, SectionHeading } from "./voice-notes-primitives";
import {
  VoiceNoteDetailSkeleton,
  VoiceNoteTranscriptSkeleton,
} from "./voice-notes-skeletons";

const POLL_INTERVAL_MS = 5_000;

type LoadState = "loading" | "ready" | "missing";

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

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
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="h-6 text-[11px]"
        disabled={busy}
        onClick={() => onTranscribe(false)}
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <AudioLines className="size-3" />
        )}
        Transcribe
      </Button>
    );
  }

  if (status === "queued" || status === "transcribing") {
    const fraction =
      progress && progress.total > 0 ? progress.completed / progress.total : 0;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {status}
          {progress && progress.total > 0 && (
            <span className="text-foreground">
              {progress.completed}/{progress.total}
            </span>
          )}
        </div>
        {progress && progress.total > 0 && (
          <div className="h-px w-full bg-border">
            <div
              className="h-px bg-foreground transition-[width] duration-500"
              style={{ width: `${fraction * 100}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex items-start gap-2">
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive" />
        <p className="min-w-0 flex-1 text-[11px] break-words text-destructive">
          {error ?? "failed"}
        </p>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-6 shrink-0 text-[11px]"
          disabled={busy}
          onClick={() => onTranscribe(true)}
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RotateCw className="size-3" />
          )}
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
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        —
      </div>
    );
  }

  if (!view) return <VoiceNoteDetailSkeleton />;

  const { transcription } = view;
  const meta = [
    formatDateTime(view.recordedAt),
    view.durationMs ? formatDuration(view.durationMs) : undefined,
    formatBytes(view.sizeBytes),
    view.source,
    transcription.model,
    transcription.language,
  ].filter(Boolean);
  const segmentCount = note?.transcription.segments?.length ?? 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="flex flex-col gap-1 px-6 pt-5 pb-3">
        <div className="flex items-start gap-2">
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
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  titleCancelledRef.current = true;
                  setEditingTitle(false);
                }
              }}
              maxLength={300}
              aria-label="Voice note title"
              className="min-w-0 flex-1 bg-transparent text-sm leading-6 font-medium outline-none"
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
              className="min-w-0 flex-1 text-left text-sm leading-6 font-medium break-words hover:text-muted-foreground disabled:hover:text-foreground"
              aria-label={`Rename ${view.title}`}
            >
              {view.title}
            </button>
          )}
          <div className="flex shrink-0 items-center gap-1">
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label="More actions"
                  disabled={!note}
                >
                  {deleting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <MoreHorizontal className="size-3.5" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {transcription.status === "transcribed" && (
                  <DropdownMenuItem
                    className="text-xs"
                    disabled={transcribing}
                    onSelect={() => void transcribe(true)}
                  >
                    <RotateCw className="size-3.5" />
                    Re-transcribe
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  className="text-xs"
                  disabled={deleting}
                  onSelect={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {onClose && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
        <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {meta.join(" · ")}
        </p>
      </header>

      <dl className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-6 pb-4">
        <Property label="Context">
          <VoiceNoteContextPicker
            api={api}
            voiceNote={view}
            disabled={!note}
            onChoose={chooseContext}
          />
        </Property>
        <Property label="Tags">
          <VoiceNoteTagEditor
            tags={view.tags}
            suggestions={tagSuggestions}
            disabled={!note}
            onChange={(tags) => void changeTags(tags)}
          />
        </Property>
        {!note && view.noteIds.length > 0 && (
          <Property label="Notes">
            <Skeleton className="mt-1 h-3 w-40" />
          </Property>
        )}
        {note && note.linkedNotes.length > 0 && (
          <Property label="Notes">
            <ul className="flex flex-col">
              {note.linkedNotes.map((linked) => (
                <li key={linked._id}>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/dashboard/notes?note=${encodeURIComponent(linked._id)}`,
                      )
                    }
                    className="-mx-1.5 flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs hover:bg-muted/60"
                  >
                    <FileText className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{linked.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Property>
        )}
        {view.groups.length > 0 && (
          <Property label="Groups">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
              {view.groups.map((group) => (
                <span
                  key={group._id}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <ContextDot color={group.color} />
                  {group.name}
                </span>
              ))}
            </div>
          </Property>
        )}
      </dl>

      <div className="sticky top-0 z-20 border-y bg-background/95 px-6 pt-5 pb-2 backdrop-blur-sm">
        <VoiceNotePlayer
          voiceNoteId={voiceNoteId}
          waveform={view.waveform}
          playback={playback}
        />
      </div>

      <section className="flex flex-col gap-3 px-6 pt-4 pb-10">
        <SectionHeading
          title="Transcript"
          meta={
            segmentCount > 1
              ? `${segmentCount} · ${formatSpan(view.durationMs ?? 0)}`
              : undefined
          }
        />
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
      </section>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="truncate">
              Delete “{view.title}”?
            </AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs tabular-nums">
              {meta.slice(0, 3).join(" · ")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void remove()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
