"use client";

import type { Portfolio, PortfolioPerformance } from "@repo/markets/schemas";
import { Button } from "@repo/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "../provider";
import { money, trimQuantity } from "./format";
import { type TradeKind, TradeTicket } from "./trade-ticket";

/**
 * Which portfolio a chart-side trade lands in. Remembered because the answer is
 * the same on almost every trade, and re-picking it each time is the friction
 * this surface exists to remove.
 */
const STORAGE_KEY = "markets.quickTrade.portfolio";

export interface QuickTradeProps {
  ticker: string;
  lastPrice: number | null;
}

export function QuickTrade({ ticker, lastPrice }: QuickTradeProps) {
  const { client } = useAdmin();
  const [portfolios, setPortfolios] = useState<Portfolio[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [performance, setPerformance] = useState<PortfolioPerformance | null>(
    null,
  );
  const [open, setOpen] = useState<TradeKind | null>(null);

  useEffect(() => {
    client
      .get<{ portfolios: Portfolio[] }>("/markets/portfolios")
      .then((data) => {
        setPortfolios(data.portfolios);
        const remembered =
          typeof window === "undefined"
            ? null
            : window.localStorage.getItem(STORAGE_KEY);
        const exists = data.portfolios.some((item) => item.id === remembered);
        setSelected(exists ? remembered : (data.portfolios[0]?.id ?? null));
      })
      .catch(() => setPortfolios([]));
  }, [client]);

  const loadPerformance = useCallback(
    (id: string, cancelled: () => boolean = () => false) =>
      client
        .get<PortfolioPerformance>(`/markets/portfolios/${id}/performance`)
        .then((data) => {
          if (!cancelled()) setPerformance(data);
        })
        .catch(() => {
          if (!cancelled()) setPerformance(null);
        }),
    [client],
  );

  useEffect(() => {
    if (!selected) {
      setPerformance(null);
      return;
    }
    // Without the guard a slow response for the previous portfolio can resolve
    // last, so the popover shows the wrong cash balance and held quantity and
    // the ticket receives the wrong positions.
    let cancelled = false;
    void loadPerformance(selected, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [selected, loadPerformance]);

  const choose = useCallback((id: string) => {
    setSelected(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const submit = useCallback(
    async (input: Record<string, unknown>) => {
      if (!selected) throw new Error("No portfolio");
      await client.post(`/markets/portfolios/${selected}/trades`, input);
      await loadPerformance(selected);
    },
    [client, selected, loadPerformance],
  );

  if (!portfolios || portfolios.length === 0 || !selected) return null;

  const portfolio = portfolios.find((item) => item.id === selected);
  if (!portfolio) return null;

  const held =
    performance?.positions.find((position) => position.ticker === ticker) ??
    null;

  return (
    <div className="flex items-center gap-1.5">
      {held ? (
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {trimQuantity(held.quantity)} @ {held.avgCost.toFixed(2)}
        </span>
      ) : null}

      {(["buy", "sell"] as const).map((side) => (
        <Popover
          key={side}
          open={open === side}
          onOpenChange={(next) => setOpen(next ? side : null)}
        >
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              // Sell is disabled rather than hidden so the pair does not reflow
              // every time the chart moves to a symbol that is held.
              disabled={side === "sell" && !held}
              className={`h-7 px-2.5 text-xs ${
                side === "buy"
                  ? "border-emerald-600/40 text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-500"
                  : "border-red-600/40 text-red-700 hover:bg-red-600/10 dark:text-red-500"
              }`}
            >
              {side === "buy" ? "Buy" : "Sell"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Select value={selected} onValueChange={choose}>
                <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {portfolios.map((item) => (
                    <SelectItem
                      key={item.id}
                      value={item.id}
                      className="text-xs"
                    >
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {performance ? (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {money(performance.metrics.cash)}
                </span>
              ) : null}
            </div>

            <TradeTicket
              key={`${selected}:${ticker}:${side}`}
              baseCurrency={portfolio.baseCurrency}
              cash={performance?.metrics.cash}
              positions={performance?.positions ?? []}
              fixedTicker={ticker}
              initialPrice={lastPrice}
              initialKind={side}
              allowCashMovements={false}
              onSubmit={submit}
              onDone={() => setOpen(null)}
              submitLabel={side === "buy" ? "Buy" : "Sell"}
            />
          </PopoverContent>
        </Popover>
      ))}
    </div>
  );
}
