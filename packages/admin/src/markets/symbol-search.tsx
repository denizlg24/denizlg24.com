"use client";

import type { SymbolSearchResult } from "@repo/markets/schemas";
import { SearchField } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { useEffect, useState } from "react";
import { useAdmin } from "../provider";

export interface SymbolSearchProps {
  onSelect: (ticker: string) => void;
  placeholder?: string;
  className?: string;
}

export function SymbolSearch({
  onSelect,
  placeholder = "Ticker or company",
  className = "w-72",
}: SymbolSearchProps) {
  const { client } = useAdmin();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState("");
  const [failed, setFailed] = useState(false);

  const term = query.trim();
  useEffect(() => {
    if (!term) return;
    let disposed = false;
    const timer = setTimeout(() => {
      client
        .get<{ results: SymbolSearchResult[] }>(
          `/markets/symbols/search?q=${encodeURIComponent(term)}`,
        )
        .then((data) => {
          if (disposed) return;
          setResults(data.results);
          setFailed(false);
          setCompleted(term);
        })
        .catch(() => {
          if (disposed) return;
          setResults([]);
          setFailed(true);
          setCompleted(term);
        });
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [client, term]);

  const matches = term && completed === term ? results : [];

  const pick = (ticker: string) => {
    onSelect(ticker);
    setCompleted("");
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
          matches[0]
        ) {
          event.preventDefault();
          pick(matches[0].ticker);
        }
      }}
    >
      <SearchField
        value={query}
        onChange={(value) => {
          if (value.trim() !== term) setCompleted("");
          setQuery(value);
          setOpen(true);
        }}
        placeholder={placeholder}
        className="w-full"
      />
      {open && term ? (
        <div className="absolute top-8 left-0 z-50 w-full min-w-56 overflow-hidden rounded-md border bg-popover p-1 shadow-md">
          {matches.length === 0 ? (
            <p
              className="px-2 py-1.5 text-muted-foreground text-xs"
              role="status"
            >
              {completed !== term
                ? "Searching…"
                : failed
                  ? "Search unavailable"
                  : "No matches"}
            </p>
          ) : null}
          {matches.slice(0, 12).map((result) => (
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
