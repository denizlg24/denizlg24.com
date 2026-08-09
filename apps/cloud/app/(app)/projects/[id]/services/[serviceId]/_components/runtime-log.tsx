"use client";

import type { Deployment } from "@repo/schemas/cloud";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@repo/ui/accordion";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const MAX_LINES = 5_000;

/** Live Docker stdout/stderr for the deployment's current container. */
export function RuntimeLog({ deployment }: { deployment: Deployment }) {
  const [lines, setLines] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [closed, setClosed] = useState(false);
  const [open, setOpen] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open !== "runtime" || !deployment.containerId) return;
    setLines([]);
    setClosed(false);
    setStreaming(false);
    const source = new EventSource(api.deploy.runtimeLogsUrl(deployment.id), {
      withCredentials: true,
    });
    source.onopen = () => setStreaming(true);
    source.onmessage = (event) => {
      setLines((current) => [...current, event.data].slice(-MAX_LINES));
    };
    source.onerror = () => {
      setStreaming(false);
      setClosed(true);
      source.close();
    };
    return () => source.close();
  }, [deployment.containerId, deployment.id, open]);

  useEffect(() => {
    if (open === "runtime") bottom.current?.scrollIntoView({ block: "end" });
  }, [lines, open]);

  if (!deployment.containerId) return null;

  return (
    <Accordion
      type="single"
      collapsible
      value={open}
      onValueChange={setOpen}
      className="border-t"
    >
      <AccordionItem value="runtime" className="border-b-0">
        <AccordionTrigger className="py-3 text-sm hover:no-underline">
          <span className="flex flex-wrap items-baseline gap-2">
            Runtime logs
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {lines.length} lines
              {streaming ? " · live" : closed ? " · closed" : ""}
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="max-h-[32rem] overflow-auto rounded bg-zinc-950 p-3 text-zinc-100">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
              {lines.length > 0
                ? lines.join("\n")
                : streaming
                  ? "waiting…"
                  : "—"}
            </pre>
            <div ref={bottom} />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
