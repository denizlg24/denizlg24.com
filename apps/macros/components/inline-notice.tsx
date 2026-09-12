"use client";

import { cn } from "@repo/ui/utils";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const NOTICE_MS = 6_000;

export type NoticeTone = "error" | "info";

export interface Notice {
  tone: NoticeTone;
  message: string;
  action?: { label: string; onAction: () => void };
}

/**
 * Replaces the toast queue. A notice belongs to the surface that raised it and
 * renders in that surface's own flow, so it can never sit on top of the row the
 * owner is reaching for.
 */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNotice(null);
  }, []);

  const show = useCallback((next: Notice) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice(next);
    timer.current = setTimeout(() => {
      timer.current = null;
      setNotice(null);
    }, NOTICE_MS);
  }, []);

  const showError = useCallback(
    (error: unknown, fallback: string) => {
      show({
        tone: "error",
        message: error instanceof Error ? error.message : fallback,
      });
    },
    [show],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { notice, show, showError, clear };
}

export function InlineNotice({
  notice,
  onDismiss,
  className,
}: {
  notice: Notice | null;
  onDismiss: () => void;
  className?: string;
}) {
  if (!notice) return null;

  const isError = notice.tone === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-center gap-3 border-b border-border/70 px-4 py-2.5 text-[13px] leading-snug",
        isError ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-4 w-0.5 shrink-0 rounded-full",
          isError ? "bg-destructive" : "bg-accent",
        )}
      />
      <span className="min-w-0 flex-1">{notice.message}</span>
      {notice.action ? (
        <button
          type="button"
          onClick={() => {
            notice.action?.onAction();
            onDismiss();
          }}
          className="shrink-0 font-semibold text-foreground underline underline-offset-2"
        >
          {notice.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex size-6 shrink-0 items-center justify-center text-muted-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
