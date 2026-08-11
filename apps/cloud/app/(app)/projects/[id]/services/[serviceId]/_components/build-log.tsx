"use client";

import { isDeploymentLive } from "@repo/cloud-ui/deploy-status";
import type { Deployment } from "@repo/schemas/cloud";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@repo/ui/accordion";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

const MAX_LINES = 5_000;

/**
 * What marks a line as the failure rather than noise around it.
 *
 * Deliberately narrow. A bare `/error/i` matches "0 errors", every path
 * containing `errors.ts`, and most of a stack trace — highlighting everything
 * is the same as highlighting nothing. These are the shapes a build actually
 * dies with: BuildKit's `ERROR:` prefix, its `did not complete successfully`
 * summary, a compiler's `error:`/`error TSxxxx`, npm's `ERR!`, and a non-zero
 * exit.
 */
const ERROR_PATTERNS = [
  /^\s*(error|fatal)\b/i,
  /\berror(\s+TS\d+)?\s*:/i,
  /\bERR!/,
  /did not complete successfully/i,
  /\bexit\s+code:?\s*[1-9]/i,
  /^\s*>>>/,
];

/**
 * BuildKit's advisory output. Worth dimming apart from the failure so a wall
 * of `SecretsUsedInArgOrEnv` does not read as the cause — env genuinely is
 * baked into the image here, and those lines are expected on every build.
 */
const WARNING_PATTERNS = [
  /^\s*warn(ing)?\b/i,
  /\bwarning:/i,
  /^\s*-\s+(SecretsUsedInArgOrEnv|UndefinedVar|[A-Z][A-Za-z]+):/,
];

type LineTone = "error" | "warning" | "plain";

function toneOf(line: string): LineTone {
  if (ERROR_PATTERNS.some((pattern) => pattern.test(line))) return "error";
  if (WARNING_PATTERNS.some((pattern) => pattern.test(line))) return "warning";
  return "plain";
}

/**
 * Tails the agent's SSE stream through the API proxy. `withCredentials` is what
 * carries the session cookie: the API is on another origin, so without it every
 * stream opens unauthenticated and closes immediately.
 *
 * The line cap is not cosmetic — a build that loops printing keeps the tab
 * alive for minutes, and an unbounded array is what turns that into a hang.
 */
export function BuildLog({ deployment }: { deployment: Deployment }) {
  const [lines, setLines] = useState<string[]>([]);
  const [closed, setClosed] = useState(false);
  const failed = deployment.status === "failed";
  // Open while the build is live and while it is being read after a failure;
  // collapsed once it is history nobody asked about.
  const [open, setOpen] = useState(
    isDeploymentLive(deployment.status) || failed ? "log" : "",
  );
  const bottom = useRef<HTMLDivElement>(null);
  const firstError = useRef<HTMLSpanElement>(null);

  useEffect(() => {
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
  }, [deployment.id]);

  /**
   * Classified only once the stream is done. While a build streams, the log is
   * one string in one <pre> so an appended line costs one text update; per-line
   * spans would re-reconcile up to five thousand elements per message. Nobody
   * is picking an error out of a log that is still moving anyway.
   */
  const classified = useMemo(() => {
    if (!closed) return null;
    const rows = lines.map((line) => ({ line, tone: toneOf(line) }));
    return {
      rows,
      errors: rows.filter((row) => row.tone === "error").length,
      firstErrorIndex: rows.findIndex((row) => row.tone === "error"),
    };
  }, [closed, lines]);

  const errorCount = classified?.errors;

  useEffect(() => {
    if (open !== "log") return;
    // Depends on errorCount because the first-error ref does not exist until
    // the classified view has rendered, which happens after the stream closes
    // — long after `open` and `failed` last changed.
    const target =
      failed && firstError.current ? firstError.current : bottom.current;
    target?.scrollIntoView({ block: failed ? "center" : "end" });
  }, [open, failed, errorCount]);

  return (
    <Accordion
      type="single"
      collapsible
      value={open}
      onValueChange={setOpen}
      className="border-t"
    >
      <AccordionItem value="log" className="border-b-0">
        <AccordionTrigger className="py-3 text-sm hover:no-underline">
          <span className="flex flex-wrap items-baseline gap-2">
            {failed ? "Build failed" : "Build logs"}
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {lines.length} {closed ? "lines" : "lines · streaming"}
            </span>
            {errorCount !== undefined && errorCount > 0 && (
              <span className="text-xs font-normal text-destructive tabular-nums">
                {errorCount} error{errorCount === 1 ? "" : "s"}
              </span>
            )}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="max-h-[32rem] overflow-auto rounded bg-muted/40 p-3">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
              {classified === null
                ? lines.length > 0
                  ? lines.join("\n")
                  : "—"
                : classified.rows.length === 0
                  ? "—"
                  : classified.rows.map((row, index) => (
                      <span
                        // Log lines have no id and repeat freely; the index is
                        // the only stable identity, and the list is replaced
                        // wholesale rather than reordered.
                        key={index}
                        ref={
                          index === classified.firstErrorIndex
                            ? firstError
                            : undefined
                        }
                        className={
                          row.tone === "error"
                            ? "block bg-destructive/10 text-destructive"
                            : row.tone === "warning"
                              ? "block text-muted-foreground"
                              : "block"
                        }
                      >
                        {row.line || " "}
                      </span>
                    ))}
            </pre>
            <div ref={bottom} />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
