"use client";

import type { LatexCompileDiagnostic } from "@repo/schemas";
import { cn } from "@repo/ui/utils";
import { useEffect, useRef } from "react";
import type { LatexEditorCompileError } from "./types";

function location(diagnostic: LatexCompileDiagnostic): string | null {
  if (diagnostic.file) {
    return diagnostic.line === null
      ? diagnostic.file
      : `${diagnostic.file}:${diagnostic.line}`;
  }
  return diagnostic.line === null ? null : `l.${diagnostic.line}`;
}

/**
 * The output pane: parsed errors first, the raw log under them. While a
 * compile streams it follows the tail, unless the reader has scrolled up.
 */
export function CompileOutput({
  log,
  error,
  compiling,
  className,
}: {
  log: string;
  error: LatexEditorCompileError | null;
  compiling: boolean;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !followRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [log, error]);

  useEffect(() => {
    if (compiling) followRef.current = true;
  }, [compiling]);

  const diagnostics = error?.diagnostics ?? [];

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const node = event.currentTarget;
        followRef.current =
          node.scrollHeight - node.scrollTop - node.clientHeight < 24;
      }}
      className={cn(
        "h-full overflow-auto font-mono text-[11px] leading-4.5",
        className,
      )}
    >
      {error ? (
        <div className="flex flex-col gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-2">
          {diagnostics.length === 0 ? (
            <p className="text-destructive">{error.message}</p>
          ) : (
            diagnostics.map((diagnostic, index) => {
              const where = location(diagnostic);
              return (
                <div
                  key={`${where ?? "?"}:${index}`}
                  className="flex flex-col gap-1"
                >
                  <p className="text-foreground">
                    {where ? (
                      <span className="mr-2 text-destructive">{where}</span>
                    ) : null}
                    {diagnostic.message}
                  </p>
                  {diagnostic.context ? (
                    <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                      {diagnostic.context}
                    </pre>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}
      {log ? (
        <pre className="whitespace-pre-wrap break-words p-3 text-muted-foreground">
          {log}
        </pre>
      ) : null}
    </div>
  );
}
