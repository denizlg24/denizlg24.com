"use client";

import { type IVoiceNote, VOICE_NOTE_MAX_BYTES } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCcw,
  RotateCw,
  Search,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DiscardUnsavedDialog } from "@/components/voice-notes/discard-unsaved-dialog";
import { formatBytes, formatSpan } from "@/components/voice-notes/format";
import {
  formatDuration,
  useVoiceRecorder,
} from "@/components/voice-notes/voice-recorder-provider";
import type { denizApi } from "@/lib/api-wrapper";

const UPLOAD_ACCEPT =
  "audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav,audio/x-m4a,.m4a";

export function VoiceNotesHeader({
  api,
  counts,
  query,
  onQueryChange,
  refreshing,
  onRefresh,
  onUploaded,
}: {
  api: denizApi;
  counts?: { shown: number; total: number; totalDurationMs: number };
  query: string;
  onQueryChange: (query: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  onUploaded: (voiceNote: IVoiceNote) => void;
}) {
  const recorder = useVoiceRecorder();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > VOICE_NOTE_MAX_BYTES) {
      toast.error(
        `Audio must be ${formatBytes(VOICE_NOTE_MAX_BYTES)} or smaller`,
      );
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", file.name.replace(/\.[^.]+$/, ""));
    formData.set("source", "upload");
    const result = await api.UPLOAD<{ voiceNote: IVoiceNote }>({
      endpoint: "voice-notes",
      formData,
    });
    setUploading(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    onUploaded(result.voiceNote);
  };

  const recordingActive =
    recorder.status === "recording" || recorder.status === "paused";
  const recorderBusy =
    recorder.status === "requesting" || recorder.status === "uploading";

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2 md:h-12 md:flex-nowrap md:py-0">
      <SidebarTrigger className="-ml-1 size-7 md:hidden" />
      <Mic className="size-4 shrink-0" />
      <h1 className="shrink-0 text-sm font-medium">Voice notes</h1>
      {counts && (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {counts.shown} / {counts.total} · {formatSpan(counts.totalDurationMs)}
        </span>
      )}

      <div className="ml-auto flex w-full items-center gap-2 md:w-auto">
        <div className="relative grow md:w-64 md:grow-0">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                onQueryChange("");
              }
            }}
            className="h-7 pr-7 pl-7 text-xs"
            placeholder="Search"
            aria-label="Search voice notes"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="absolute top-1/2 right-1.5 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          onClick={onRefresh}
          aria-label="Refresh"
        >
          <RefreshCcw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(event) => void upload(event)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          Upload
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7"
          disabled={
            recorderBusy || (!recordingActive && Boolean(recorder.unsaved))
          }
          onClick={() =>
            recordingActive
              ? recorder.stopRecording()
              : void recorder.startRecording()
          }
        >
          {recorderBusy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : recordingActive ? (
            <Square className="size-3.5 fill-current" />
          ) : (
            <Mic className="size-3.5" />
          )}
          {recordingActive ? "Save" : "Record"}
        </Button>
      </div>
    </div>
  );
}

export function RecordingStrip() {
  const recorder = useVoiceRecorder();
  const paused = recorder.status === "paused";
  if (recorder.status !== "recording" && !paused) return null;

  return (
    <div
      className={`flex items-center gap-3 border-b px-4 py-2 ${
        paused ? "bg-amber-500/5" : "bg-red-500/5"
      }`}
    >
      <span
        className={`size-2 shrink-0 rounded-full ${
          paused ? "bg-amber-500" : "animate-pulse bg-red-500"
        }`}
      />
      <span className="w-14 shrink-0 font-mono text-xs tabular-nums">
        {formatDuration(recorder.elapsedMs)}
      </span>
      <div className="flex h-7 flex-1 items-center gap-px overflow-hidden">
        {recorder.levels.map((level, index) => (
          <span
            key={index}
            className={`min-w-px flex-1 ${paused ? "bg-amber-500/60" : "bg-red-500/75"}`}
            style={{ height: `${Math.max(8, level * 100)}%` }}
          />
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7"
        onClick={paused ? recorder.resumeRecording : recorder.pauseRecording}
      >
        {paused ? (
          <Play className="size-3.5 fill-current" />
        ) : (
          <Pause className="size-3.5 fill-current" />
        )}
        {paused ? "Resume" : "Pause"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-destructive hover:text-destructive"
        onClick={recorder.discardRecording}
      >
        <Trash2 className="size-3.5" />
        Discard
      </Button>
    </div>
  );
}

export function UnsavedRecordingStrip() {
  const recorder = useVoiceRecorder();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const unsaved = recorder.unsaved;
  if (!unsaved) return null;
  const retrying = recorder.status === "uploading";

  return (
    <div className="flex items-center gap-3 border-b bg-destructive/5 px-4 py-1.5">
      <span className="size-2 shrink-0 rounded-full bg-destructive" />
      <span className="shrink-0 text-xs font-medium">Unsaved</span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatDuration(unsaved.durationMs)} · {formatBytes(unsaved.sizeBytes)}
      </span>
      {recorder.error && !retrying && (
        <span className="min-w-0 truncate text-[11px] text-destructive">
          {recorder.error}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7"
          disabled={retrying}
          onClick={() => void recorder.retryUnsaved()}
        >
          {retrying ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCw className="size-3.5" />
          )}
          Retry
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-destructive hover:text-destructive"
          disabled={retrying}
          onClick={() => setConfirmDiscard(true)}
        >
          <Trash2 className="size-3.5" />
          Discard
        </Button>
      </div>
      <DiscardUnsavedDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
      />
    </div>
  );
}
