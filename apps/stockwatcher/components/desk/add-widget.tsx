"use client";

import { type FormEvent, type ReactNode, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  type DeskFunction,
  deskFunctions,
  type Widget,
  type WidgetKind,
  widgetSchema,
} from "@/lib/desk";
import { defaultClockExchanges, type ExchangeKey } from "@/lib/exchanges";
import type { Workspace } from "@/lib/models";
import { monitorFunctions } from "@/lib/terminal";
import { type Range, ranges, type Universe, universes } from "@/lib/universes";
import { ExchangePicker } from "./clocks";
import { parseSymbols } from "./frame";

export const widgetCatalog: Record<
  WidgetKind,
  { label: string; description: string; span: 1 | 2 }
> = {
  brief: {
    label: "Morning brief",
    description: "AI daily brief, or a computed summary when AI is off",
    span: 2,
  },
  holdings: {
    label: "Holdings",
    description: "Positions at live prices, totals per currency",
    span: 1,
  },
  movers: {
    label: "Movers",
    description: "Top gainers and losers in your book or watchlist",
    span: 1,
  },
  watchlist: {
    label: "Watchlist",
    description: "Dense quote table for one list",
    span: 1,
  },
  chart: { label: "Chart", description: "Price chart for one symbol", span: 1 },
  news: {
    label: "News",
    description: "Headlines for holdings or chosen symbols",
    span: 1,
  },
  alerts: {
    label: "Alerts",
    description: "Active levels and recent triggers",
    span: 1,
  },
  compare: {
    label: "Compare",
    description: "Relative performance of 2–6 symbols",
    span: 2,
  },
  market: {
    label: "Market",
    description: "Heat map of a market group",
    span: 2,
  },
  insight: {
    label: "Note",
    description: "A pinned markdown note",
    span: 1,
  },
  overlay: {
    label: "Overlay chart",
    description: "A saved multi-series chart; pin one from Charts (G)",
    span: 2,
  },
  function: {
    label: "Terminal function",
    description: "GC, RRG, CORR, TOP, EVTS, PRSK, FXC, CMDTY, CRYP or GRID",
    span: 2,
  },
  clocks: {
    label: "Market clocks",
    description: "Local time, session state and countdown per exchange",
    span: 1,
  },
  fearGreed: {
    label: "Fear & Greed",
    description: "CNN market sentiment gauge, 0 to 100, with its recent trend",
    span: 1,
  },
};

const kinds = Object.keys(widgetCatalog).filter(
  (kind): kind is WidgetKind =>
    kind !== "overlay" && Object.hasOwn(widgetCatalog, kind),
);
const rangeKeys = Object.keys(ranges).filter((key): key is Range =>
  Object.hasOwn(ranges, key),
);
const universeKeys = Object.keys(universes).filter((key): key is Universe =>
  Object.hasOwn(universes, key),
);
const allBooks = "__all__";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function AddWidgetDialog({
  workspace,
  close,
  add,
}: {
  workspace: Workspace;
  close: () => void;
  add: (widget: Widget) => Promise<void>;
}) {
  const [kind, setKind] = useState<WidgetKind>("chart");
  const [span, setSpan] = useState<1 | 2>(widgetCatalog.chart.span);
  const [bookId, setBookId] = useState(allBooks);
  const [source, setSource] = useState<"holdings" | "watchlist">("holdings");
  const [watchlistId, setWatchlistId] = useState(
    workspace.watchlists[0]?.id ?? "",
  );
  const [symbol, setSymbol] = useState("");
  const [range, setRange] = useState<Range>("1M");
  const [symbolsText, setSymbolsText] = useState("");
  const [since, setSince] = useState("");
  const [universe, setUniverse] = useState<Universe>(
    universeKeys[0] ?? "S&P 500",
  );
  const [fn, setFn] = useState<DeskFunction>("RRG");
  const [clockExchanges, setClockExchanges] = useState<ExchangeKey[]>(
    defaultClockExchanges,
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<Error>();
  const [working, setWorking] = useState(false);

  function draft() {
    const base = { id: crypto.randomUUID(), span };
    switch (kind) {
      case "brief":
      case "alerts":
      case "fearGreed":
        return { ...base, kind };
      case "holdings":
        return {
          ...base,
          kind,
          ...(bookId !== allBooks ? { bookId } : {}),
        };
      case "movers":
        return { ...base, kind, source };
      case "watchlist":
        return { ...base, kind, ...(watchlistId ? { watchlistId } : {}) };
      case "chart":
        return { ...base, kind, symbol: symbol.trim().toUpperCase(), range };
      case "news": {
        const symbols = parseSymbols(symbolsText);
        return { ...base, kind, ...(symbols.length ? { symbols } : {}) };
      }
      case "compare":
        return {
          ...base,
          kind,
          symbols: parseSymbols(symbolsText),
          ...(since ? { since } : {}),
        };
      case "market":
        return { ...base, kind, universe };
      case "function": {
        const symbols = parseSymbols(symbolsText);
        return { ...base, kind, fn, ...(symbols.length ? { symbols } : {}) };
      }
      case "clocks":
        return { ...base, kind, exchanges: clockExchanges };
      case "insight":
        return {
          ...base,
          kind,
          title,
          body,
          symbols: parseSymbols(symbolsText),
          createdAt: new Date().toISOString(),
        };
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = widgetSchema.safeParse(draft());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join(".");
      setError(
        new Error(
          field === "symbol"
            ? "Enter a valid ticker, e.g. AAPL or ASML.AS."
            : field?.startsWith("symbols")
              ? kind === "compare"
                ? "Enter two to six valid tickers, separated by commas."
                : "Enter valid tickers, separated by commas."
              : field === "title"
                ? "Give the note a title."
                : (issue?.message ?? "Check the widget settings."),
        ),
      );
      return;
    }
    setWorking(true);
    setError(undefined);
    try {
      await add(parsed.data);
      close();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error("Unable to add the widget."),
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
      <DialogContent showCloseButton={!working} className="desk-add-dialog">
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
          <DialogDescription>
            It is added to the end of your desk and saved to your workspace.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          <div
            className="desk-kind-grid"
            role="radiogroup"
            aria-label="Widget type"
          >
            {kinds.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === kind}
                className="desk-kind"
                onClick={() => {
                  setKind(option);
                  setSpan(widgetCatalog[option].span);
                  setError(undefined);
                }}
              >
                <strong>{widgetCatalog[option].label}</strong>
                <span>{widgetCatalog[option].description}</span>
              </button>
            ))}
          </div>

          {kind === "holdings" ? (
            <Row label="Book">
              <Select value={bookId} onValueChange={setBookId}>
                <SelectTrigger aria-label="Book">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={allBooks}>All books</SelectItem>
                  {workspace.books.map((book) => (
                    <SelectItem key={book.id} value={book.id}>
                      {book.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          ) : null}

          {kind === "movers" ? (
            <Row label="Rank movers from">
              <Select
                value={source}
                onValueChange={(value) =>
                  setSource(value === "watchlist" ? "watchlist" : "holdings")
                }
              >
                <SelectTrigger aria-label="Movers source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="holdings">Holdings</SelectItem>
                  <SelectItem value="watchlist">First watchlist</SelectItem>
                </SelectContent>
              </Select>
            </Row>
          ) : null}

          {kind === "watchlist" && workspace.watchlists.length ? (
            <Row label="Watchlist">
              <Select value={watchlistId} onValueChange={setWatchlistId}>
                <SelectTrigger aria-label="Watchlist">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workspace.watchlists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          ) : null}

          {kind === "chart" ? (
            <div className="desk-form-row">
              <Row label="Symbol">
                <Input
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value)}
                  placeholder="AAPL"
                  maxLength={20}
                  autoFocus
                  required
                />
              </Row>
              <Row label="Period">
                <Select
                  value={range}
                  onValueChange={(value) => {
                    const next = rangeKeys.find((key) => key === value);
                    if (next) setRange(next);
                  }}
                >
                  <SelectTrigger aria-label="Period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {rangeKeys.map((key) => (
                      <SelectItem key={key} value={key}>
                        {key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            </div>
          ) : null}

          {kind === "news" || kind === "compare" || kind === "insight" ? (
            <Row
              label={
                kind === "news"
                  ? "Symbols (blank follows your holdings)"
                  : kind === "compare"
                    ? "Symbols (2–6)"
                    : "Related symbols (optional)"
              }
            >
              <Input
                value={symbolsText}
                onChange={(event) => setSymbolsText(event.target.value)}
                placeholder="AAPL, MSFT, ASML.AS"
                maxLength={240}
                required={kind === "compare"}
              />
            </Row>
          ) : null}

          {kind === "compare" ? (
            <Row label="Since (optional)">
              <Input
                type="date"
                value={since}
                onChange={(event) => setSince(event.target.value)}
              />
            </Row>
          ) : null}

          {kind === "function" ? (
            <div className="desk-form-row">
              <Row label="Function">
                <Select
                  value={fn}
                  onValueChange={(value) => {
                    const next = deskFunctions.find((item) => item === value);
                    if (next) setFn(next);
                  }}
                >
                  <SelectTrigger aria-label="Function">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {deskFunctions.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item} ·{" "}
                        {
                          monitorFunctions.find((entry) => entry.code === item)
                            ?.label
                        }
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              {fn === "CORR" || fn === "TOP" || fn === "GRID" ? (
                <Row label="Tickers (optional)">
                  <Input
                    value={symbolsText}
                    onChange={(event) => setSymbolsText(event.target.value)}
                    placeholder="SPY, TLT, GLD"
                  />
                </Row>
              ) : null}
            </div>
          ) : null}

          {kind === "market" ? (
            <Row label="Market group">
              <Select
                value={universe}
                onValueChange={(value) => {
                  const next = universeKeys.find((key) => key === value);
                  if (next) setUniverse(next);
                }}
              >
                <SelectTrigger aria-label="Market group">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {universeKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          ) : null}

          {kind === "clocks" ? (
            <div className="field">
              <span>Exchanges</span>
              <ExchangePicker
                selected={clockExchanges}
                onChange={setClockExchanges}
              />
            </div>
          ) : null}

          {kind === "insight" ? (
            <>
              <Row label="Title">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  required
                />
              </Row>
              <Row label="Note (markdown)">
                <Textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  maxLength={4000}
                  rows={5}
                />
              </Row>
            </>
          ) : null}

          <div className="desk-span-choice" role="group" aria-label="Width">
            <span className="kicker">Width</span>
            <button
              type="button"
              className="chip"
              aria-pressed={span === 1}
              onClick={() => setSpan(1)}
            >
              Half
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={span === 2}
              onClick={() => setSpan(2)}
            >
              Full
            </button>
          </div>

          <Failure error={error} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={working}>
              {working
                ? "Adding…"
                : `Add ${widgetCatalog[kind].label.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
