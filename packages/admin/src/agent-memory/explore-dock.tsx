"use client";

import type { AgentMemory, AgentMemoryExploreResponse } from "@repo/schemas";
import { agentMemoryExploreResponseSchema } from "@repo/schemas";
import { useEffect, useRef, useState } from "react";
import { AdminApiError } from "../client";
import { useAdmin } from "../provider";

interface ExploreEntry {
  id: number;
  query: string;
  state: "loading" | "done" | "error";
  error?: string;
  response?: AgentMemoryExploreResponse;
}

const SCORE_CELLS = 8;

function scoreBar(score: number): string {
  return "█".repeat(Math.round(score * SCORE_CELLS)).padEnd(SCORE_CELLS, "·");
}

function shortDate(value: string): string {
  return new Date(value)
    .toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "2-digit",
    })
    .toLowerCase();
}

/**
 * CLI-styled probe into the memory store: queries go straight to the
 * embedding index and come back as scored memories with their evidence
 * events — no language model between the prompt and the recall.
 */
export function ExploreDock({
  onSelect,
}: {
  onSelect: (memory: AgentMemory) => void;
}) {
  const { client } = useAdmin();
  const [entries, setEntries] = useState<ExploreEntry[]>([]);
  const [input, setInput] = useState("");
  const [historyOffset, setHistoryOffset] = useState(0);
  const nextIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  const submit = () => {
    const query = input.trim();
    if (query.length < 2) return;
    const id = nextIdRef.current++;
    setEntries((prev) => [...prev, { id, query, state: "loading" }]);
    setInput("");
    setHistoryOffset(0);
    void (async () => {
      try {
        const raw = await client.post<unknown>("agent-memory/explore", {
          query,
        });
        const response = agentMemoryExploreResponseSchema.parse(raw);
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? { ...entry, state: "done" as const, response }
              : entry,
          ),
        );
      } catch (error) {
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  state: "error" as const,
                  error:
                    error instanceof AdminApiError
                      ? error.message
                      : "recall failed",
                }
              : entry,
          ),
        );
      }
    })();
  };

  const recallHistory = (delta: 1 | -1) => {
    const queries = entries.map((entry) => entry.query);
    const next = Math.min(queries.length, Math.max(0, historyOffset + delta));
    setHistoryOffset(next);
    setInput(next === 0 ? "" : (queries[queries.length - next] ?? ""));
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col font-mono text-xs"
      onClick={() => inputRef.current?.focus()}
    >
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {entries.map((entry) => (
          <div key={entry.id} className="mb-4 space-y-1">
            <p>
              <span className="text-muted-foreground">❯ </span>
              {entry.query}
            </p>

            {entry.state === "loading" && (
              <p className="animate-pulse text-muted-foreground">
                ▮ retrieving…
              </p>
            )}

            {entry.state === "error" && (
              <p className="text-destructive">✕ {entry.error}</p>
            )}

            {entry.state === "done" && entry.response && (
              <>
                {entry.response.results.map((hit) => (
                  <div key={hit.memory.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(hit.memory)}
                      className="group flex w-full items-baseline gap-3 text-left"
                    >
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {hit.score.toFixed(2)}
                      </span>
                      <span
                        aria-hidden
                        className="shrink-0 text-muted-foreground/40"
                      >
                        {scoreBar(hit.score)}
                      </span>
                      <span className="w-16 shrink-0 text-muted-foreground">
                        {hit.memory.memoryType}
                      </span>
                      <span className="min-w-0 truncate group-hover:underline">
                        {hit.memory.statement}
                      </span>
                    </button>
                    {hit.events.map((event) => (
                      <div
                        key={event.eventId}
                        className="flex items-baseline gap-2 pl-8 text-muted-foreground/70"
                      >
                        <span aria-hidden>└</span>
                        <span className="shrink-0 tabular-nums">
                          {shortDate(event.occurredAt)}
                        </span>
                        <span className="shrink-0">{event.sourceType}</span>
                        {event.snapshot && (
                          <span className="min-w-0 truncate">
                            {event.snapshot}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                <p className="text-muted-foreground/60">
                  {entry.response.results.length === 0
                    ? "no recall"
                    : `${entry.response.results.length} ${
                        entry.response.results.length === 1
                          ? "memory"
                          : "memories"
                      } · ${entry.response.tookMs}ms`}
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t px-4 py-3">
        <span className="text-muted-foreground">❯</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setHistoryOffset(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              recallHistory(1);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              recallHistory(-1);
            }
          }}
          placeholder="probe the memory lattice…"
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/40"
          // biome-ignore lint/a11y/noAutofocus: terminal-style dock — the prompt is the view's only control.
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
