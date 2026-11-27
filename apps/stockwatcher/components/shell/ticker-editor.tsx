"use client";

import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Save } from "@/components/forms";
import { useQuotes, useSearch } from "@/components/market-widgets";
import { Failure } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { defaultTicker, maxTickerSymbols, tickerLabel } from "@/lib/ticker";
import { symbolPattern } from "@/lib/universes";

function move(list: string[], from: number, to: number) {
  if (to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function TickerEditor({
  symbols,
  save,
  close,
}: {
  symbols: string[];
  save: Save;
  close: () => void;
}) {
  const [draft, setDraft] = useState(symbols);
  const [query, setQuery] = useState("");
  const [queryKey, setQueryKey] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<Error>();
  useEffect(() => {
    const timer = setTimeout(() => setQueryKey(query.trim()), 260);
    return () => clearTimeout(timer);
  }, [query]);
  const search = useSearch(queryKey);
  const { data: quoteData } = useQuotes(draft);
  const names = new Map(
    quoteData?.quotes.map((quote) => [quote.symbol, quote.name]),
  );
  const full = draft.length >= maxTickerSymbols;
  const typed = query.trim().toUpperCase();
  const results = (search.data?.instruments ?? []).slice(0, 8);
  const direct =
    symbolPattern.test(typed) && !results.some((item) => item.symbol === typed);

  function add(symbol: string) {
    if (full || draft.includes(symbol)) return;
    setDraft([...draft, symbol]);
    setQuery("");
    setQueryKey("");
  }

  async function submit() {
    setWorking(true);
    setError(undefined);
    try {
      await save((current) => ({
        ...current,
        settings: { ...current.settings, ticker: draft },
      }));
      close();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error("The ticker was not saved."),
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !working) close();
      }}
    >
      <DialogContent className="ticker-dialog" showCloseButton={!working}>
        <DialogHeader>
          <DialogTitle>Ticker</DialogTitle>
          <DialogDescription>
            {`Symbols scrolling under the top bar, up to ${maxTickerSymbols}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="ticker-editor">
          <section aria-labelledby="ticker-add">
            <h3 className="kicker" id="ticker-add">
              Add
            </h3>
            <form
              className="search-form"
              onSubmit={(event) => {
                event.preventDefault();
                const match =
                  results.find((item) => item.symbol === typed)?.symbol ??
                  results[0]?.symbol ??
                  (direct ? typed : "");
                if (match) add(match);
              }}
            >
              <Search size={15} aria-hidden />
              <Input
                aria-label="Search symbols to add"
                placeholder="Apple, ASML.AS, EURUSD=X…"
                value={query}
                maxLength={100}
                disabled={full}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
            </form>
            <Failure error={search.error} />
            <ul className="ruled-list ticker-results">
              {results.map((item) => {
                const added = draft.includes(item.symbol);
                return (
                  <li key={item.symbol}>
                    <button
                      type="button"
                      disabled={added || full}
                      onClick={() => add(item.symbol)}
                    >
                      <span>
                        <strong>{item.symbol}</strong>
                        <small>{item.name}</small>
                      </span>
                      <span className="meta">
                        {added ? "Added" : <Plus size={14} aria-hidden />}
                      </span>
                    </button>
                  </li>
                );
              })}
              {direct ? (
                <li>
                  <button
                    type="button"
                    disabled={draft.includes(typed) || full}
                    onClick={() => add(typed)}
                  >
                    <span>
                      <strong>{typed}</strong>
                      <small>Add this ticker as typed</small>
                    </span>
                    <Plus size={14} aria-hidden />
                  </button>
                </li>
              ) : null}
            </ul>
            {queryKey && !search.isLoading && !results.length && !direct ? (
              <p className="meta">No symbols found.</p>
            ) : null}
            {full ? (
              <p className="meta">
                The ticker is full. Remove a symbol to add another.
              </p>
            ) : null}
          </section>
          <section aria-labelledby="ticker-order">
            <h3 className="kicker" id="ticker-order">
              In the ticker · {draft.length}
            </h3>
            {draft.length ? (
              <ol className="ruled-list ticker-order">
                {draft.map((symbol, index) => (
                  <li key={symbol}>
                    <span>
                      <strong>{tickerLabel(symbol)}</strong>
                      <small>
                        {tickerLabel(symbol) === symbol
                          ? (names.get(symbol) ?? "")
                          : symbol}
                      </small>
                    </span>
                    <span className="row-actions">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Move ${symbol} earlier`}
                        disabled={index === 0}
                        onClick={() => setDraft(move(draft, index, index - 1))}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Move ${symbol} later`}
                        disabled={index === draft.length - 1}
                        onClick={() => setDraft(move(draft, index, index + 1))}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${symbol}`}
                        onClick={() =>
                          setDraft(draft.filter((item) => item !== symbol))
                        }
                      >
                        <X />
                      </Button>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty">
                <strong>No symbols</strong>
                The ticker stays empty until you add one.
              </p>
            )}
          </section>
        </div>
        <Failure error={error} />
        <DialogFooter className="ticker-dialog-foot">
          <Button
            variant="ghost"
            disabled={working}
            onClick={() => setDraft([...defaultTicker])}
          >
            Reset to benchmarks
          </Button>
          <span className="grow" />
          <Button variant="outline" disabled={working} onClick={close}>
            Cancel
          </Button>
          <Button disabled={working} onClick={() => void submit()}>
            {working ? "Saving…" : "Save ticker"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
