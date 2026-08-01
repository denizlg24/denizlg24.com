"use client";

import type { SymbolSearchResult } from "@repo/markets/schemas";
import { Input } from "@repo/ui/input";
import { Search } from "lucide-react";
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

  return (
    <div className={`relative ${className}`}>
      <Search className="-translate-y-1/2 absolute top-1/2 left-2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        className="h-8 pl-7 text-xs"
      />
      {open && results.length > 0 ? (
        <div className="absolute top-9 left-0 z-50 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {results.slice(0, 12).map((result) => (
            <button
              key={result.ticker}
              type="button"
              onMouseDown={() => {
                onSelect(result.ticker);
                setQuery("");
              }}
              className="flex w-full items-baseline justify-between px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <span className="font-medium">{result.ticker}</span>
              <span className="ml-2 truncate text-muted-foreground">
                {result.name}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
