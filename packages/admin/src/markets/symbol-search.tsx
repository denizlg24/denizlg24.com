"use client";

import type { SymbolSearchResult } from "@repo/markets/schemas";
import { SearchField } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { useEffect, useRef, useState } from "react";
import { useAdmin } from "../provider";

export interface SymbolSearchProps {
  onSelect: (ticker: string) => void;
  placeholder?: string;
  className?: string;
}

export function SymbolSearch({
  onSelect,
  placeholder = "Ticker",
  className = "w-72",
}: SymbolSearchProps) {
  const { client } = useAdmin();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    // Debounced: search hits Mongo, not a provider, but a keystroke-per-query
    // still floods the route on a fast typist.
    timer.current = setTimeout(() => {
      client
        .get<{ results: SymbolSearchResult[] }>(
          `/markets/symbols/search?q=${encodeURIComponent(query.trim())}`,
        )
        .then((data) => setResults(data.results))
        .catch(() => setResults([]));
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [client, query]);

  const pick = (ticker: string) => {
    onSelect(ticker);
    setQuery("");
    setOpen(false);
  };

  return (
    // The list closes on focus leaving the container rather than on the input's
    // own blur, so Tab can reach the results; selection is bound to `click`,
    // which Enter and Space fire and `onMouseDown` does not.
    <div
      className={cn("relative", className)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement &&
          results[0]
        ) {
          event.preventDefault();
          pick(results[0].ticker);
        }
      }}
    >
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder={placeholder}
        className="w-full"
      />
      {open && results.length > 0 ? (
        <div className="absolute top-8 left-0 z-50 w-full min-w-56 overflow-hidden rounded-md border bg-popover p-1 shadow-md">
          {results.slice(0, 12).map((result) => (
            <button
              key={result.ticker}
              type="button"
              onClick={() => pick(result.ticker)}
              className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
            >
              <span className="font-medium text-accent-strong">
                {result.ticker}
              </span>
              <span className="truncate text-muted-foreground">
                {result.name}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
