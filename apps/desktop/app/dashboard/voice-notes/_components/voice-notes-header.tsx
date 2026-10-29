"use client";

import { type IVoiceNote, VOICE_NOTE_MAX_BYTES } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCcw,
  RotateCw,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { DiscardUnsavedDialog } from "@/components/voice-notes/discard-unsaved-dialog";
import { formatBytes, formatSpan } from "@/components/voice-notes/format";
import {
  formatDuration,
  useVoiceRecorder,
} from "@/components/voice-notes/voice-recorder-provider";
import type { denizApi } from "@/lib/api-wrapper";
import { cn } from "@/lib/utils";

const UPLOAD_ACCEPT =
  "audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav,audio/x-m4a,.m4a";

export function VoiceNotesHeader({
  api,
  counts,
  refreshing,
  onRefresh,
  onUploaded,
}: {
  api: denizApi;
  counts?: { shown: number; total: number; totalDurationMs: number };
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
    <DashboardPageHeader icon={<Mic />} title="Voice notes">
      {counts && (
        <span className="mr-2 hidden text-xs tabular-nums text-muted-foreground sm:inline">
          {counts.shown}/{counts.total} · {formatSpan(counts.totalDurationMs)}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onRefresh}
        aria-label="Refresh"
      >
        <RefreshCcw className={refreshing ? "animate-spin" : undefined} />
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
        variant="ghost"
        size="sm"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
        Upload
      </Button>
      <Button
        type="button"
        size="sm"
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
          <Loader2 className="animate-spin" />
        ) : recordingActive ? (
          <Square className="fill-current" />
        ) : (
          <Mic />
        )}
        {recordingActive ? "Save" : "Record"}
      </Button>
    </DashboardPageHeader>
  );
}

export function RecordingStrip() {
  const recorder = useVoiceRecorder();
  const paused = recorder.status === "paused";
  if (recorder.status !== "recording" && !paused) return null;

  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center gap-3 border-b px-3",
        paused ? "bg-status-warning/5" : "bg-status-critical/5",
      )}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          paused ? "bg-status-warning" : "animate-pulse bg-status-critical",
        )}
      />
      <span className="w-14 shrink-0 text-xs tabular-nums text-accent-strong">
        {formatDuration(recorder.elapsedMs)}
      </span>
      <div className="flex h-7 flex-1 items-center gap-px overflow-hidden">
        {recorder.levels.map((level, index) => (
          <span
            key={index}
            className={cn(
              "min-w-px flex-1",
              paused ? "bg-status-warning/60" : "bg-status-critical/75",
            )}
            style={{ height: `${Math.max(8, level * 100)}%` }}
          />
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={paused ? recorder.resumeRecording : recorder.pauseRecording}
      >
        {paused ? (
          <Play className="fill-current" />
        ) : (
          <Pause className="fill-current" />
        )}
        {paused ? "Resume" : "Pause"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={recorder.discardRecording}
      >
        <Trash2 />
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
    <div className="flex h-10 shrink-0 items-center gap-3 border-b bg-status-critical/5 px-3">
      <span className="size-2 shrink-0 rounded-full bg-status-critical" />
      <span className="shrink-0 text-xs font-medium text-accent-strong">
        Unsaved
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatDuration(unsaved.durationMs)} · {formatBytes(unsaved.sizeBytes)}
      </span>
      {recorder.error && !retrying && (
        <span className="min-w-0 truncate text-xs text-destructive">
          {recorder.error}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={retrying}
          onClick={() => void recorder.retryUnsaved()}
        >
          {retrying ? <Loader2 className="animate-spin" /> : <RotateCw />}
          Retry
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={retrying}
          onClick={() => setConfirmDiscard(true)}
        >
          <Trash2 />
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
