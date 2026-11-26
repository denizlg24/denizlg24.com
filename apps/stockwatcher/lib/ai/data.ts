import "server-only";
import { fxRates } from "@/lib/fx";
import { baseValuation } from "@/lib/fx-rates";
import { quotes, search, series } from "@/lib/market";
import type { News, Quote, Workspace } from "@/lib/models";
import { type Position, positionsFor, valuePosition } from "@/lib/portfolio";
import type { Range } from "@/lib/universes";
import { describeRule } from "../alerts";

export const marketSource = (symbols: string[]) =>
  symbols.length && symbols.every((symbol) => symbol.endsWith(".ME"))
    ? "Moscow Exchange"
    : symbols.some((symbol) => symbol.endsWith(".ME"))
      ? "Yahoo Finance · Moscow Exchange"
      : "Yahoo Finance";

const round = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? null
    : Math.round(value * 10 ** digits) / 10 ** digits;

const isoTime = (seconds: number) =>
  seconds > 0 ? new Date(seconds * 1000).toISOString() : null;

export async function priceHistory(symbol: string, range: Range) {
  const data = await series(symbol, range);
  const points = data.points;
  if (points.length < 2)
    throw new Error(`No price history is available for ${symbol}.`);
  const closes = points.map((point) => point.close);
  const first = closes[0];
  const last = closes.at(-1)!;
  const step = Math.max(1, Math.ceil(points.length / 120));
  const sampled = points.filter(
    (_, index) => index % step === 0 || index === points.length - 1,
  );
  return {
    symbol,
    range,
    currency: data.quote?.currency ?? null,
    changePercent: round((last / first - 1) * 100),
    high: round(Math.max(...points.map((point) => point.high)), 4),
    low: round(Math.min(...points.map((point) => point.low)), 4),
    first: { t: points[0].time, c: round(first, 4) ?? first },
    last: { t: points.at(-1)!.time, c: round(last, 4) ?? last },
    points: sampled.map((point) => ({
      t: point.time,
      c: round(point.close, 4) ?? point.close,
    })),
    source: data.source ?? marketSource([symbol]),
    asOf: isoTime(data.quote?.time ?? points.at(-1)!.time),
  };
}

export async function newsFor(symbols: string[], limit = 12) {
  const results = await Promise.allSettled(
    symbols.slice(0, 8).map((symbol) => search(symbol)),
  );
  const seen = new Set<string>();
  const items: (News & { symbol: string })[] = [];
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    for (const item of result.value.news) {
      const key = item.url || item.title.toLowerCase();
      const title = item.title.toLowerCase();
      if (seen.has(key) || seen.has(title)) continue;
      seen.add(key);
      seen.add(title);
      items.push({ ...item, symbol: symbols[index] });
    }
  });
  if (!items.length && results.every((result) => result.status === "rejected"))
    throw new Error("News is temporarily unavailable.");
  return items.sort((a, b) => b.time - a.time).slice(0, limit);
}

type Aggregate = Position & { books: Set<string> };

export async function portfolioSnapshot(workspace: Workspace, bookId?: string) {
  const books = bookId
    ? workspace.books.filter((book) => book.id === bookId)
    : workspace.books;
  if (bookId && !books.length)
    throw new Error("That portfolio does not exist.");
  const aggregate = new Map<string, Aggregate>();
  for (const book of books) {
    const trades = workspace.trades.filter((trade) => trade.bookId === book.id);
    for (const position of positionsFor(trades)) {
      const key = `${position.symbol}:${position.currency}`;
      const current = aggregate.get(key);
      if (current) {
        current.quantity += position.quantity;
        current.cost += position.cost;
        current.realized += position.realized;
        current.books.add(book.name);
      } else {
        aggregate.set(key, { ...position, books: new Set([book.name]) });
      }
    }
  }
  const open = [...aggregate.values()].filter((item) => item.quantity > 0);
  const live = open.length
    ? await quotes(open.map((item) => item.symbol)).catch(() => [])
    : [];
  const bySymbol = new Map(live.map((quote) => [quote.symbol, quote]));
  const valued = open.map((position) => {
    const quote = bySymbol.get(position.symbol);
    const value = valuePosition(position, quote);
    return { position, quote, value };
  });
  const currencyValue = new Map<string, number>();
  for (const { position, value } of valued)
    if (value.marketValue != null)
      currencyValue.set(
        position.currency,
        (currencyValue.get(position.currency) ?? 0) + value.marketValue,
      );
  const positions = valued
    .map(({ position, quote, value }) => {
      const base = value.marketValue
        ? value.marketValue - (value.dayChange ?? 0)
        : null;
      const totalInCurrency = currencyValue.get(position.currency);
      return {
        symbol: position.symbol,
        name: quote?.name ?? position.symbol,
        currency: position.currency,
        quantity: round(position.quantity, 6),
        averageCost: round(position.cost / position.quantity, 4),
        price: round(value.price, 4),
        marketValue: round(value.marketValue),
        unrealized: round(value.unrealized),
        unrealizedPercent:
          value.unrealized != null && position.cost > 0
            ? round((value.unrealized / position.cost) * 100)
            : null,
        dayChange: round(value.dayChange),
        dayChangePercent:
          value.dayChange != null && base
            ? round((value.dayChange / base) * 100)
            : null,
        weightInCurrencyPercent:
          value.marketValue != null && totalInCurrency
            ? round((value.marketValue / totalInCurrency) * 100)
            : null,
        books: [...position.books],
        quoteTime: quote ? isoTime(quote.time) : null,
      };
    })
    .sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1));
  const totals = new Map<
    string,
    {
      currency: string;
      positions: number;
      marketValue: number;
      cost: number;
      unrealized: number;
      dayChange: number;
      realized: number;
      unpriced: number;
    }
  >();
  for (const position of aggregate.values()) {
    const entry = totals.get(position.currency) ?? {
      currency: position.currency,
      positions: 0,
      marketValue: 0,
      cost: 0,
      unrealized: 0,
      dayChange: 0,
      realized: 0,
      unpriced: 0,
    };
    entry.realized += position.realized;
    totals.set(position.currency, entry);
  }
  for (const { position, value } of valued) {
    const entry = totals.get(position.currency)!;
    entry.positions += 1;
    if (value.marketValue == null) {
      entry.unpriced += 1;
      continue;
    }
    entry.marketValue += value.marketValue;
    entry.cost += position.cost;
    entry.unrealized += value.unrealized ?? 0;
    entry.dayChange += value.dayChange ?? 0;
  }
  const baseCurrency = workspace.settings.baseCurrency;
  const rates = await fxRates([...totals.keys()], baseCurrency);
  const valuation = baseValuation(
    [...totals.values()].map((entry) => ({
      currency: entry.currency,
      positions: entry.positions,
      unpriced: entry.unpriced,
      marketValue: entry.marketValue,
      cost: entry.cost,
      unrealized: entry.unrealized,
      dayChange: entry.dayChange,
    })),
    rates,
    baseCurrency,
  );
  const baseTotal = valuation.block.marketValue;
  const baseWeight = (currency: string, marketValue: number | null) => {
    const fx = valuation.rates.get(currency);
    return fx && marketValue != null && baseTotal
      ? round(((marketValue * fx.rate) / baseTotal) * 100)
      : null;
  };
  return {
    scope: bookId ? books[0].name : "All portfolios",
    books: workspace.books.map((book) => ({ id: book.id, name: book.name })),
    positions: positions
      .map((position) => ({
        ...position,
        weightInBasePercent: baseWeight(
          position.currency,
          position.marketValue,
        ),
      }))
      .slice(0, 60),
    omittedPositions: Math.max(0, positions.length - 60),
    totalsByCurrency: [...totals.values()].map((entry) => ({
      currency: entry.currency,
      positions: entry.positions,
      marketValue: round(entry.marketValue),
      costOfPriced: round(entry.cost),
      unrealized: round(entry.unrealized),
      unrealizedPercent: entry.cost
        ? round((entry.unrealized / entry.cost) * 100)
        : null,
      dayChange: round(entry.dayChange),
      dayChangePercent:
        entry.marketValue - entry.dayChange
          ? round(
              (entry.dayChange / (entry.marketValue - entry.dayChange)) * 100,
            )
          : null,
      realized: round(entry.realized),
      unpricedPositions: entry.unpriced,
    })),
    base: valuation.block,
    note: "totalsByCurrency are in each position's own currency. Only the base block is converted, and only with the FX rates it lists.",
    source: marketSource(open.map((item) => item.symbol)),
    asOf: new Date().toISOString(),
  };
}

const compactQuote = (quote: Quote) => ({
  symbol: quote.symbol,
  name: quote.name,
  price: round(quote.price, 4),
  currency: quote.currency,
  changePercent: round(quote.percent),
  time: isoTime(quote.time),
});

export async function watchlistSnapshot(workspace: Workspace) {
  const lists = workspace.watchlists.map((list) => ({
    ...list,
    symbols: list.symbols.slice(0, 40),
  }));
  const symbols = [...new Set(lists.flatMap((list) => list.symbols))];
  const live = symbols.length ? await quotes(symbols).catch(() => []) : [];
  const bySymbol = new Map(live.map((quote) => [quote.symbol, quote]));
  return {
    watchlists: workspace.watchlists.map((list, index) => ({
      id: list.id,
      name: list.name,
      size: list.symbols.length,
      quotes: lists[index].symbols.flatMap((symbol) => {
        const quote = bySymbol.get(symbol);
        return quote ? [compactQuote(quote)] : [];
      }),
      unavailable: lists[index].symbols.filter(
        (symbol) => !bySymbol.has(symbol),
      ),
    })),
    source: marketSource(symbols),
    asOf: new Date().toISOString(),
  };
}

export function workspaceDigest(workspace: Workspace) {
  const lines: string[] = [];
  if (workspace.books.length)
    lines.push(
      `Portfolios: ${workspace.books.map((book) => `${book.name} (bookId ${book.id})`).join("; ")}`,
    );
  const holdings = new Map<string, { quantity: number; cost: number }>();
  for (const book of workspace.books) {
    try {
      for (const position of positionsFor(
        workspace.trades.filter((trade) => trade.bookId === book.id),
      )) {
        if (position.quantity <= 0) continue;
        const key = `${position.symbol} ${position.currency}`;
        const entry = holdings.get(key) ?? { quantity: 0, cost: 0 };
        entry.quantity += position.quantity;
        entry.cost += position.cost;
        holdings.set(key, entry);
      }
    } catch {
      lines.push(`Portfolio ${book.name} has an inconsistent trade ledger.`);
    }
  }
  if (holdings.size)
    lines.push(
      `Open positions (symbol currency: quantity @ average cost): ${[
        ...holdings,
      ]
        .slice(0, 40)
        .map(
          ([key, entry]) =>
            `${key}: ${round(entry.quantity, 4)} @ ${round(entry.cost / entry.quantity, 2)}`,
        )
        .join(
          "; ",
        )}${holdings.size > 40 ? ` (+${holdings.size - 40} more)` : ""}`,
    );
  else if (workspace.books.some((book) => book.broker))
    lines.push("No open positions recorded.");
  else
    lines.push(
      "The user's book is empty: no open positions and no broker link.",
    );
  for (const list of workspace.watchlists.slice(0, 10))
    lines.push(
      `Watchlist "${list.name}" (watchlistId ${list.id}): ${list.symbols.slice(0, 30).join(", ") || "empty"}${list.symbols.length > 30 ? ` (+${list.symbols.length - 30})` : ""}`,
    );
  const alerts = workspace.alerts.filter((alert) => alert.enabled);
  if (alerts.length)
    lines.push(
      `Active alerts: ${alerts
        .slice(0, 20)
        .map(
          (alert) =>
            `${alert.symbol} ${describeRule(alert)}${alert.repeat === "rearm" ? " (repeating)" : ""}${alert.note ? ` — ${alert.note}` : ""}${alert.lastTriggered ? ` (last fired ${alert.lastTriggered} at ${alert.triggeredPrice})` : ""}`,
        )
        .join("; ")}`,
    );
  return lines.join("\n");
}
