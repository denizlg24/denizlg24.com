"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import { Button } from "@repo/ui/button";
import { useCopy } from "@repo/ui/copy-button";
import { cn } from "@repo/ui/utils";
import { ArrowDownToLine, Check, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MAX_LINES = 5_000;

/** Distance from the bottom, in px, still counted as following the tail. */
const STICK_SLACK_PX = 24;

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
 *
 * The viewport is height-capped rather than allowed to grow. A build log is
 * thousands of lines and this sits above the deployment's other sections, so an
 * uncapped one buries them under a page nobody can scroll past — and the log
 * gets its own scrollbar only if it has a height to overflow.
 */
export function LogStream({
  subscribe,
  resetKey,
  emptyLabel = "waiting for output…",
  maxHeightClass = "max-h-[32rem]",
}: {
  subscribe: LogSubscribe;
  /** Changing this restarts the stream and clears what is on screen. */
  resetKey: string;
  emptyLabel?: string;
  maxHeightClass?: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<
    "connecting" | "streaming" | "ended" | "error"
  >("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  // Duplicated deliberately. The ref is what the append path reads, so a scroll
  // event that changes nothing costs nothing; the state exists only so the
  // follow button can appear, and is written only when the answer actually
  // flips. Driving the whole thing off state would re-render — and re-join five
  // thousand lines — on every scroll event of a long build log.
  const stick = useRef(true);
  const [following, setFollowing] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const { copied, copy } = useCopy();

  const setStick = useCallback((next: boolean) => {
    if (stick.current === next) return;
    stick.current = next;
    setFollowing(next);
  }, []);

  const scrollToTail = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    // Assigning scrollTop rather than calling scrollIntoView on a sentinel:
    // scrollIntoView walks every scrollable ancestor, so each new line would
    // also drag the page itself down to the log.
    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLines([]);
    setStatus("connecting");
    setDetail(null);
    stick.current = true;
    setFollowing(true);
    let seen = false;
    // Buffered and flushed on a timer rather than appended per line. A build log
    // replays from its first line as fast as the socket delivers, so a render per
    // line means thousands of copies of a growing array for one open — and the
    // trimming only has to hold once per flush, not once per line.
    let buffered: string[] = [];
    let flush: ReturnType<typeof setTimeout> | null = null;
    const drain = () => {
      flush = null;
      const batch = buffered;
      buffered = [];
      if (batch.length === 0) return;
      setLines((current) => [...current, ...batch].slice(-MAX_LINES));
    };

    subscribe((line) => {
      if (!seen) {
        seen = true;
        setStatus("streaming");
      }
      buffered.push(line);
      if (buffered.length > MAX_LINES) buffered = buffered.slice(-MAX_LINES);
      if (flush === null) flush = setTimeout(drain, 100);
    }, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setStatus("ended");
      })
      .catch((streamError: unknown) => {
        if (controller.signal.aborted) return;
        setStatus("error");
        setDetail(errorMessage(streamError));
      })
      // Whatever is still buffered when the stream ends has to land, or the last
      // few lines of a short log are never shown.
      .finally(() => {
        if (!controller.signal.aborted) drain();
      });
    return () => {
      controller.abort();
      if (flush !== null) clearTimeout(flush);
    };
    // `subscribe` is a fresh closure on every render; `resetKey` is what
    // actually identifies the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (stick.current) scrollToTail();
  }, [lines, scrollToTail]);

  const text = useMemo(
    () => (lines.length > 0 ? lines.join("\n") : null),
    [lines],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {status}
          {detail ? `: ${detail}` : ""}
          {lines.length > 0 ? ` · ${lines.length} lines` : ""}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {/* Only offered once the tail has actually been left behind —
              otherwise it is a button that does nothing, permanently. */}
          {following ? null : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px]"
              onClick={() => {
                setStick(true);
                scrollToTail();
              }}
            >
              <ArrowDownToLine className="size-3" />
              follow
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px]"
            disabled={text === null}
            onClick={() => {
              if (text !== null) void copy(text);
            }}
          >
            {copied ? (
              <Check className="size-3 text-status-good" />
            ) : (
              <Copy className="size-3" />
            )}
            copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px]"
            onClick={() => {
              setLines([]);
              setStick(true);
            }}
          >
            clear
          </Button>
        </div>
      </div>
      <div
        ref={viewport}
        className={cn(
          "min-h-64 flex-1 overflow-auto rounded-md border bg-zinc-950 p-3 text-zinc-100",
          maxHeightClass,
        )}
        onScroll={() => {
          const element = viewport.current;
          if (!element) return;
          setStick(
            element.scrollHeight - element.scrollTop - element.clientHeight <
              STICK_SLACK_PX,
          );
        }}
      >
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5">
          {text ?? emptyLabel}
        </pre>
      </div>
    </div>
  );
}
