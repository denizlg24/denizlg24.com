"use client";

import { useMemo } from "react";
import { useQuotes } from "@/components/market-widgets";
import { positionsFor, valuePosition, type Position } from "@/lib/portfolio";
import type { Quote, Workspace } from "@/lib/models";

export type HoldingRow = Position & {
  quote?: Quote;
  price: number | null;
  marketValue: number | null;
  unrealized: number | null;
  dayChange: number | null;
  dayPercent: number | null;
  weight: number | null;
};

export type CurrencyTotal = {
  currency: string;
  value: number;
  cost: number;
  day: number;
  unrealized: number;
  unpriced: number;
  positions: number;
};

function openPositions(workspace: Workspace, bookId?: string) {
  const books = bookId
    ? workspace.books.filter((book) => book.id === bookId)
    : workspace.books;
  const merged = new Map<string, Position>();
  for (const book of books) {
    const trades = workspace.trades.filter((trade) => trade.bookId === book.id);
    for (const position of positionsFor(trades)) {
      if (position.quantity <= 0) continue;
      const key = `${position.symbol}:${position.currency}`;
      const current = merged.get(key);
      merged.set(
        key,
        current
          ? {
              ...current,
              quantity: current.quantity + position.quantity,
              cost: current.cost + position.cost,
              realized: current.realized + position.realized,
            }
          : position,
      );
    }
  }
  return [...merged.values()];
}

export function useHoldings(
  workspace: Workspace,
  refresh: boolean,
  bookId?: string,
) {
  const computed = useMemo(() => {
    try {
      return { positions: openPositions(workspace, bookId), error: undefined };
    } catch (cause) {
      return {
        positions: [] as Position[],
        error:
          cause instanceof Error
            ? cause
            : new Error("The transaction ledger could not be valued."),
      };
    }
  }, [workspace, bookId]);
  const symbols = useMemo(
    () => computed.positions.map((position) => position.symbol),
    [computed.positions],
  );
  const quotes = useQuotes(symbols, refresh);
  const { rows, totals } = useMemo(() => {
    const bySymbol = new Map(
      quotes.data?.quotes.map((quote) => [quote.symbol, quote]),
    );
    const valued = computed.positions.map((position) => {
      const quote = bySymbol.get(position.symbol);
      const value = valuePosition(position, quote);
      const previousValue =
        value.marketValue != null && value.dayChange != null
          ? value.marketValue - value.dayChange
          : null;
      return {
        ...position,
        ...value,
        quote,
        dayPercent:
          previousValue && value.dayChange != null
            ? (value.dayChange / previousValue) * 100
            : null,
      };
    });
    const totals = new Map<string, CurrencyTotal>();
    for (const row of valued) {
      const total = totals.get(row.currency) ?? {
        currency: row.currency,
        value: 0,
        cost: 0,
        day: 0,
        unrealized: 0,
        unpriced: 0,
        positions: 0,
      };
      total.positions += 1;
      total.cost += row.cost;
      if (row.marketValue == null) total.unpriced += 1;
      else total.value += row.marketValue;
      total.day += row.dayChange ?? 0;
      total.unrealized += row.unrealized ?? 0;
      totals.set(row.currency, total);
    }
    const rows: HoldingRow[] = valued
      .map((row) => {
        const total = totals.get(row.currency);
        return {
          ...row,
          weight:
            row.marketValue != null && total?.value
              ? (row.marketValue / total.value) * 100
              : null,
        };
      })
      .toSorted((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1));
    return {
      rows,
      totals: [...totals.values()].toSorted((a, b) => b.value - a.value),
    };
  }, [computed.positions, quotes.data]);
  return {
    rows,
    totals,
    ledgerError: computed.error,
    quotes,
    loading: quotes.isLoading,
  };
}

export const firstWatchlist = (workspace: Workspace, id?: string) =>
  workspace.watchlists.find((list) => list.id === id) ??
  workspace.watchlists[0];
