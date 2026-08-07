"use client";

import type { Deployment } from "@repo/schemas/cloud";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/sheet";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const MAX_LINES = 5_000;

/**
 * Tails the agent's SSE stream through the API proxy. `withCredentials` is what
 * carries the session cookie: the API is on another origin, so without it every
 * stream opens unauthenticated and closes immediately.
 *
 * The line cap is not cosmetic — a build that loops printing keeps the tab
 * alive for minutes, and an unbounded array is what turns that into a hang.
 */
export function LogSheet({
  deployment,
  onClose,
}: {
  deployment: Deployment | null;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [closed, setClosed] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!deployment) return;
    setLines([]);
    setClosed(false);
    const source = new EventSource(api.deploy.logsUrl(deployment.id), {
      withCredentials: true,
    });
    source.onmessage = (event) => {
      setLines((current) => [...current, event.data].slice(-MAX_LINES));
    };
    // The agent closes the stream when the build ends, which arrives here as an
    // error. There is nothing to retry, and reconnecting would replay the log.
    source.onerror = () => {
      setClosed(true);
      source.close();
    };
    return () => source.close();
  }, [deployment]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  return (
    <Sheet
      open={deployment !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">
            {deployment?.gitSha.slice(0, 7)} · {deployment?.gitRef}
          </SheetTitle>
          <SheetDescription>
            {closed ? "stream closed" : "streaming"} · {lines.length} lines
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
            {lines.join("\n")}
          </pre>
          <div ref={bottom} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
