"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import { Button } from "@repo/ui/button";
import { useEffect, useRef, useState } from "react";

const MAX_LINES = 5_000;

export type LogSubscribe = (
  onLine: (line: string) => void,
  signal: AbortSignal,
) => Promise<void>;

/**
 * A follow-the-tail log view over one SSE subscription.
 *
 * `subscribe` is passed in rather than a URL because the two sources differ in
 * more than their path: a build log replays from its first line and ends, while a
 * runtime log starts at a tail and follows until the container stops. Both are
 * just "call me with lines until the signal aborts".
 */
export function LogStream({
  subscribe,
  resetKey,
  emptyLabel = "waiting for output…",
}: {
  subscribe: LogSubscribe;
  /** Changing this restarts the stream and clears what is on screen. */
  resetKey: string;
  emptyLabel?: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<
    "connecting" | "streaming" | "ended" | "error"
  >("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  const tail = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLines([]);
    setStatus("connecting");
    setDetail(null);
    stick.current = true;
    let seen = false;
    subscribe((line) => {
      if (!seen) {
        seen = true;
        setStatus("streaming");
      }
      setLines((current) => [...current, line].slice(-MAX_LINES));
    }, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setStatus("ended");
      })
      .catch((streamError: unknown) => {
        if (controller.signal.aborted) return;
        setStatus("error");
        setDetail(errorMessage(streamError));
      });
    return () => controller.abort();
    // `subscribe` is a fresh closure on every render; `resetKey` is what
    // actually identifies the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (stick.current) tail.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted-foreground">
          {status}
          {detail ? `: ${detail}` : ""}
          {lines.length > 0 ? ` · ${lines.length} lines` : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[11px]"
          onClick={() => setLines([])}
        >
          clear
        </Button>
      </div>
      <div
        ref={viewport}
        className="min-h-64 flex-1 overflow-auto rounded-md border bg-zinc-950 p-3 text-zinc-100"
        onScroll={() => {
          const element = viewport.current;
          if (!element) return;
          stick.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            24;
        }}
      >
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5">
          {lines.length > 0 ? lines.join("\n") : emptyLabel}
        </pre>
        <div ref={tail} />
      </div>
    </div>
  );
}
