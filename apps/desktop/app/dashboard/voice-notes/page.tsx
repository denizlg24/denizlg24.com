"use client";

import type {
  INote,
  IVoiceNote,
  VoiceNotesResponse,
  VoiceNoteTranscriptionStatus,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import {
  Loader2,
  Mic,
  RefreshCcw,
  Search,
  Square,
  Trash2,
  Upload,
  Waves,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { VoiceNoteCard } from "@/components/voice-notes/voice-note-card";
import {
  formatDuration,
  useVoiceRecorder,
} from "@/components/voice-notes/voice-recorder-provider";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";

type StatusFilter = "all" | VoiceNoteTranscriptionStatus;

export default function VoiceNotesPage() {
  const router = useRouter();
  const { settings } = useUserSettings();
  const recorder = useVoiceRecorder();
  const api = useMemo(() => new denizApi(settings.apiKey), [settings.apiKey]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [voiceNotes, setVoiceNotes] = useState<IVoiceNote[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      const params = new URLSearchParams({ limit: "100" });
      if (query.trim()) params.set("q", query.trim());
      if (status !== "all") params.set("status", status);
      const result = await api.GET<VoiceNotesResponse>({
        endpoint: `voice-notes?${params.toString()}`,
      });
      if (silent) setRefreshing(false);
      else setLoading(false);
      if ("code" in result) {
        toast.error(result.message);
        return;
      }
      setVoiceNotes(result.voiceNotes);
      setTotal(result.total);
    },
    [api, query, status],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(), 180);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const hasPending = voiceNotes.some((voiceNote) =>
      ["queued", "transcribing"].includes(voiceNote.transcription.status),
    );
    if (!hasPending) return;
    const interval = setInterval(() => void load(true), 5_000);
    return () => clearInterval(interval);
  }, [load, voiceNotes]);

  useEffect(() => {
    const handleChanged = () => void load(true);
    window.addEventListener("voice-notes:changed", handleChanged);
    return () =>
      window.removeEventListener("voice-notes:changed", handleChanged);
  }, [load]);

  const upload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) {
        toast.error("Audio must be 25 MB or smaller");
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
      setVoiceNotes((current) => [result.voiceNote, ...current]);
      setTotal((current) => current + 1);
      window.dispatchEvent(new CustomEvent("voice-notes:changed"));
      toast.success("Voice note uploaded");
    },
    [api],
  );

  const recording = recorder.status === "recording";
  const recorderBusy =
    recorder.status === "requesting" || recorder.status === "uploading";

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2 md:h-12 md:flex-nowrap md:py-0">
        <SidebarTrigger className="-ml-1 size-7 md:hidden" />
        <Waves className="size-4" />
        <h1 className="text-sm font-medium">Voice notes</h1>
        <span className="text-xs tabular-nums text-muted-foreground">
          {voiceNotes.length} / {total}
        </span>

        <div className="ml-auto flex w-full items-center gap-2 md:w-auto">
          <div className="relative grow md:w-72">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-7 pl-7 text-xs"
              placeholder="Search voice notes and transcripts…"
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as StatusFilter)}
          >
            <SelectTrigger size="sm" className="h-7 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="untranscribed">Not transcribed</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="transcribing">Transcribing</SelectItem>
              <SelectItem value="transcribed">Transcribed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => void load(true)}
            title="Refresh"
          >
            <RefreshCcw
              className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav,.m4a"
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
            disabled={recorderBusy}
            onClick={() =>
              recording
                ? recorder.stopRecording()
                : void recorder.startRecording()
            }
          >
            {recorderBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : recording ? (
              <Square className="size-3.5 fill-current" />
            ) : (
              <Mic className="size-3.5" />
            )}
            {recording ? "Save" : "Record"}
          </Button>
        </div>
      </div>

      {recording && (
        <div className="flex items-center gap-3 border-b bg-red-500/5 px-4 py-3">
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
          <span className="w-12 font-mono text-xs tabular-nums">
            {formatDuration(recorder.elapsedMs)}
          </span>
          <div className="flex h-8 flex-1 items-center gap-px overflow-hidden">
            {recorder.levels.map((level, index) => (
              <span
                key={`${index}-${level}`}
                className="min-w-px flex-1 bg-red-500/75"
                style={{ height: `${Math.max(8, level * 100)}%` }}
              />
            ))}
          </div>
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
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : voiceNotes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            —
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-6xl gap-3 p-4 lg:grid-cols-2">
            {voiceNotes.map((voiceNote) => (
              <VoiceNoteCard
                key={voiceNote._id}
                api={api}
                voiceNote={voiceNote}
                onChanged={(next) =>
                  setVoiceNotes((current) =>
                    current.map((item) =>
                      item._id === next._id ? next : item,
                    ),
                  )
                }
                onDeleted={(voiceNoteId) => {
                  setVoiceNotes((current) =>
                    current.filter((item) => item._id !== voiceNoteId),
                  );
                  setTotal((current) => Math.max(0, current - 1));
                }}
                onGenerated={(note: INote) =>
                  router.push(
                    `/dashboard/notes?note=${encodeURIComponent(note._id)}`,
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
