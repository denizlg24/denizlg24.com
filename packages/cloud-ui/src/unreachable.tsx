"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { RotateCw } from "lucide-react";

/**
 * The API lives on the Pi and the apps live on Vercel, so the Pi rebooting
 * looks exactly like a dead app unless every surface says which one it is.
 */
export function Unreachable({
  detail,
  onRetry,
  retrying,
  className,
}: {
  detail?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Cloud unreachable</p>
        <p className="font-mono text-xs text-muted-foreground">
          {detail ?? "api.denizlg24.com"}
        </p>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          disabled={retrying}
          onClick={onRetry}
        >
          <RotateCw className={cn("size-3.5", retrying && "animate-spin")} />
          Retry
        </Button>
      )}
    </div>
  );
}

/** Inline strip for surfaces that still have stale data worth showing. */
export function UnreachableBanner({
  onRetry,
  retrying,
}: {
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-status-critical/40 bg-status-critical/5 px-4 py-1.5 text-xs"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-status-critical" />
      <span className="text-muted-foreground">
        Cloud unreachable — showing last known state
      </span>
      {onRetry && (
        <button
          type="button"
          disabled={retrying}
          onClick={onRetry}
          className="ml-auto shrink-0 underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          Retry
        </button>
      )}
    </div>
  );
}
