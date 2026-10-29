"use client";

import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import {
  ChevronDown,
  Loader,
  Mic,
  Pause,
  Play,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { DiscardUnsavedDialog } from "./discard-unsaved-dialog";
import { formatBytes } from "./format";
import { formatDuration, useVoiceRecorder } from "./voice-recorder-provider";

export function BackgroundActionsMenu({
  align = "end",
}: {
  align?: "start" | "end";
}) {
  const recorder = useVoiceRecorder();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const recording = recorder.status === "recording";
  const paused = recorder.status === "paused";
  const active = recording || paused;
  const uploading = recorder.status === "uploading";
  const busy = recorder.status === "requesting" || uploading;
  const unsaved = recorder.unsaved;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:bg-surface/70 hover:text-accent-strong"
            aria-label="Background actions"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {active ? (
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  paused
                    ? "bg-status-warning"
                    : "animate-pulse bg-status-critical",
                )}
              />
            ) : unsaved ? (
              <span className="size-1.5 rounded-full bg-status-critical" />
            ) : (
              <Loader className="size-3" />
            )}
            {active && (
              <span className="tabular-nums">
                {formatDuration(recorder.elapsedMs)}
              </span>
            )}
            <ChevronDown className="size-2.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-56">
          <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Background
          </DropdownMenuLabel>
          {unsaved && (
            <>
              <DropdownMenuLabel className="flex items-center gap-1.5 py-1 text-xs font-normal tabular-nums text-destructive">
                <span className="size-1.5 rounded-full bg-status-critical" />
                Unsaved · {formatDuration(unsaved.durationMs)} ·{" "}
                {formatBytes(unsaved.sizeBytes)}
              </DropdownMenuLabel>
              <DropdownMenuItem
                disabled={uploading}
                onSelect={() => void recorder.retryUnsaved()}
              >
                {uploading ? (
                  <Loader className="size-3.5 animate-spin" />
                ) : (
                  <RotateCw className="size-3.5" />
                )}
                Retry save
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={uploading}
                onSelect={() => setConfirmDiscard(true)}
              >
                <Trash2 className="size-3.5" />
                Discard unsaved
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {active ? (
            <>
              {paused ? (
                <DropdownMenuItem onSelect={recorder.resumeRecording}>
                  <Play className="size-3.5 fill-current" />
                  Resume recording
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={recorder.pauseRecording}>
                  <Pause className="size-3.5 fill-current" />
                  Pause recording
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={recorder.stopRecording}>
                <Square className="size-3.5 fill-current" />
                Save recording
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={recorder.discardRecording}
              >
                <Trash2 className="size-3.5" />
                Discard recording
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              disabled={busy || Boolean(unsaved)}
              onSelect={() => void recorder.startRecording()}
            >
              <Mic className="size-3.5" />
              {uploading ? "Saving recording" : "Start voice recording"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DiscardUnsavedDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
      />
    </>
  );
}
