"use client";

import { ConfirmDialog } from "@repo/ui/confirm-button";
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
    <ConfirmDialog
      open={open && hasUnsaved}
      onOpenChange={onOpenChange}
      title="Discard unsaved recording?"
      description={
        unsaved
          ? `${formatDuration(unsaved.durationMs)} · ${formatBytes(unsaved.sizeBytes)}`
          : undefined
      }
      actionLabel="Discard"
      destructive
      onConfirm={recorder.discardUnsaved}
    />
  );
}
