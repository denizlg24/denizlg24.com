"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Activity, ChevronDown, Mic, Square, Trash2 } from "lucide-react";
import { formatDuration, useVoiceRecorder } from "./voice-recorder-provider";

export function BackgroundActionsMenu() {
  const recorder = useVoiceRecorder();
  const recording = recorder.status === "recording";
  const busy =
    recorder.status === "requesting" || recorder.status === "uploading";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Background actions"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {recording ? (
            <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
          ) : (
            <Activity className="size-3" />
          )}
          {recording && (
            <span className="tabular-nums">
              {formatDuration(recorder.elapsedMs)}
            </span>
          )}
          <ChevronDown className="size-2.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Background actions
        </DropdownMenuLabel>
        {recording ? (
          <>
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
            disabled={busy}
            onSelect={() => void recorder.startRecording()}
          >
            <Mic className="size-3.5" />
            {recorder.status === "uploading"
              ? "Saving recording"
              : "Start voice recording"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
