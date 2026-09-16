"use client";

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
import { useEffect } from "react";
import { formatBytes } from "./format";
import { formatDuration, useVoiceRecorder } from "./voice-recorder-provider";

/**
 * The unsaved blob exists nowhere else, so dropping it is confirmed even
 * though discarding a live recording is not.
 */
export function DiscardUnsavedDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const recorder = useVoiceRecorder();
  const unsaved = recorder.unsaved;
  const hasUnsaved = Boolean(unsaved);

  // A retry can land while this is open; without closing here the stale open
  // flag would raise the dialog again on the next failed save.
  useEffect(() => {
    if (open && !hasUnsaved) onOpenChange(false);
  }, [hasUnsaved, onOpenChange, open]);

  return (
    <AlertDialog open={open && hasUnsaved} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved recording?</AlertDialogTitle>
          {unsaved && (
            <AlertDialogDescription className="font-mono text-xs tabular-nums">
              {formatDuration(unsaved.durationMs)} ·{" "}
              {formatBytes(unsaved.sizeBytes)}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={recorder.discardUnsaved}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
