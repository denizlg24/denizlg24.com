"use client";

import type { Deployment } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/sheet";
import { ScrollText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const MAX_LINES = 5_000;

/**
 * Live Docker stdout/stderr for the deployment's current container, in a side
 * panel rather than inline under the build log.
 *
 * The two are not peers: a build log is a finished record of how this deployment
 * came to exist and belongs on the page, while runtime output is a live tail of a
 * process that is still running. Stacked as sibling accordions the second one
 * pushed the deployment's own facts off screen the moment it was opened.
 */
export function RuntimeLog({ deployment }: { deployment: Deployment }) {
  const [lines, setLines] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [closed, setClosed] = useState(false);
  const [open, setOpen] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const keepAtBottom = useRef(true);
  const buffered = useRef<string[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Collapsing has to clear the status too, or a reopened panel shows the
    // previous stream's "live" until its own connection lands.
    setLines([]);
    setClosed(false);
    setStreaming(false);
    keepAtBottom.current = true;
    buffered.current = [];
    if (open !== "runtime" || !deployment.containerId) return;
    const source = new EventSource(api.deploy.runtimeLogsUrl(deployment.id), {
      withCredentials: true,
    });
    source.onopen = () => setStreaming(true);
    const append = (event: MessageEvent<string>) => {
      buffered.current.push(event.data);
      if (buffered.current.length > MAX_LINES) {
        buffered.current = buffered.current.slice(-MAX_LINES);
      }
      if (flushTimer.current !== null) return;
      flushTimer.current = setTimeout(() => {
        const batch = buffered.current;
        buffered.current = [];
        flushTimer.current = null;
        if (batch.length > 0) {
          setLines((current) => [...current, ...batch].slice(-MAX_LINES));
        }
      }, 100);
    };
    // The agent names every runtime frame `log`, and `onmessage` only ever fires
    // for unnamed frames — which is why this panel used to sit on "waiting…"
    // forever while the stream was in fact delivering. Both are bound because
    // the build-log route on the same agent sends its frames unnamed.
    source.addEventListener("log", append);
    source.onmessage = append;
    // A deliberate end frame is not an error, and closing here stops
    // EventSource reconnecting to a container that has finished talking.
    source.addEventListener("end", () => {
      setStreaming(false);
      setClosed(true);
      source.close();
    });
    source.onerror = () => {
      setStreaming(false);
      setClosed(true);
      source.close();
    };
    return () => {
      source.close();
      if (flushTimer.current !== null) clearTimeout(flushTimer.current);
      flushTimer.current = null;
      buffered.current = [];
    };
  }, [deployment.containerId, deployment.id, open]);

  useEffect(() => {
    if (open === "runtime" && keepAtBottom.current) {
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [lines, open]);

  if (!deployment.containerId) return null;

  return (
    <Sheet
      open={open === "runtime"}
      onOpenChange={(next) => setOpen(next ? "runtime" : "")}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <ScrollText className="size-3.5" />
          Runtime logs
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-3xl">
        <SheetHeader className="gap-1">
          <SheetTitle className="flex flex-wrap items-baseline gap-2 text-sm">
            Runtime logs
            <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">
              {lines.length} lines
              {streaming ? " · live" : closed ? " · closed" : ""}
            </span>
          </SheetTitle>
          <p className="font-mono text-[11px] text-muted-foreground">
            {deployment.hostname}
          </p>
        </SheetHeader>
        <div
          ref={viewport}
          className="min-h-0 flex-1 overflow-auto rounded bg-zinc-950 p-3 text-zinc-100"
          onScroll={() => {
            const element = viewport.current;
            if (!element) return;
            keepAtBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              24;
          }}
        >
          <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
            {lines.length > 0 ? lines.join("\n") : streaming ? "waiting…" : "—"}
          </pre>
          <div ref={bottom} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
