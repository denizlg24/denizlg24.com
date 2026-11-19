"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Empty, Failure, Loading } from "@/components/shared";
import { useSearch } from "@/components/market-widgets";
import { symbolPattern } from "@/lib/universes";

export function SearchDialog({
  close,
  choose,
}: {
  close: () => void;
  choose: (ticker: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [queryKey, setQueryKey] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQueryKey(query.trim()), 260);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, error, isLoading } = useSearch(queryKey);
  const ticker = query.trim().toUpperCase();
  const result = data?.instruments ?? [];
  const exact =
    symbolPattern.test(ticker) &&
    !result.some((item) => item.symbol === ticker);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="search-dialog">
        <DialogHeader>
          <DialogTitle>Find a symbol</DialogTitle>
          <DialogDescription>
            Search by company name, ticker, or index.
          </DialogDescription>
        </DialogHeader>
        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
            const match =
              result.find((item) => item.symbol === ticker)?.symbol ??
              result[0]?.symbol ??
              (exact ? ticker : "");
            if (match) choose(match);
          }}
        >
          <Search size={17} />
          <Input
            aria-label="Symbol or company name"
            placeholder="Apple, ASML.AS, S&P 500…"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        </form>
        <Failure error={error} />
        {isLoading ? (
          <Loading message="Searching symbols" />
        ) : (
          <div className="search-results">
            {result.map((item) => (
              <button key={item.symbol} onClick={() => choose(item.symbol)}>
                <span>
                  <strong>{item.symbol}</strong>
                  <small>{item.name}</small>
                </span>
                <span>
                  {item.exchange ?? item.type ?? ""} <ArrowUpRight size={15} />
                </span>
              </button>
            ))}
            {exact ? (
              <button onClick={() => choose(ticker)}>
                <span>
                  <strong>Open {ticker}</strong>
                  <small>Look up this ticker directly</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ) : null}
            {!query ? (
              <Empty title="Find your next company">
                Use the exchange suffix for listings such as ASML.AS or SAP.DE.
              </Empty>
            ) : null}
            {queryKey && !result.length && !exact && !error ? (
              <Empty title="No symbols found">
                Try another name or the exchange’s ticker.
              </Empty>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
