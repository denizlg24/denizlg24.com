"use client";

import { X } from "lucide-react";
import { Streamdown } from "streamdown";
import useSWR from "swr";
import { markdownComponents } from "@/components/assistant/markdown";
import { useQuotes } from "@/components/market-widgets";
import { api, Failure, SourceLink } from "@/components/shared";
import { Button } from "@/components/ui/button";
import type { Instrument, News } from "@/lib/models";
import { amount } from "@/lib/utils";
import { firstWatchlist, useHoldings } from "./data";
import {
  DeskEmpty,
  SkeletonRows,
  Stamp,
  SymbolButton,
  useNow,
  WidgetFrame,
  type WidgetProps,
} from "./frame";

type Headline = News & { symbol: string };

async function loadHeadlines(symbols: string[]): Promise<Headline[]> {
  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const data = await api<{ instruments: Instrument[]; news: News[] }>(
        `/api/market?${new URLSearchParams({ q: symbol })}`,
      );
      return data.news.map((item) => ({ ...item, symbol }));
    }),
  );
  const fulfilled = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (!fulfilled.length && results.length) {
    const failure = results.find((result) => result.status === "rejected");
    throw failure?.reason instanceof Error
      ? failure.reason
      : new Error("Headlines are unavailable.");
  }
  const seen = new Set<string>();
  return fulfilled
    .flat()
    .filter((item) => {
      const key = item.url || item.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .toSorted((a, b) => b.time - a.time);
}

export function NewsWidget({ widget, ctx }: WidgetProps<"news">) {
  const { workspace, refresh, onOpenSymbol, onOpenView } = ctx;
  const holdings = useHoldings(workspace, refresh);
  const pinned = widget.symbols?.length ? widget.symbols : null;
  const fallback = holdings.rows.length
    ? holdings.rows.map((row) => row.symbol)
    : (firstWatchlist(workspace)?.symbols ?? []);
  const symbols = [...new Set(pinned ?? fallback)].slice(0, 8);
  const scope = pinned
    ? symbols.join(" · ")
    : holdings.rows.length
      ? "Largest holdings"
      : "First watchlist";
  const { data, error, mutate, isLoading } = useSWR(
    symbols.length ? ["desk-news", ...symbols] : null,
    ([, ...keys]) => loadHeadlines(keys),
    {
      refreshInterval: refresh ? 300_000 : 0,
      errorRetryCount: 1,
      revalidateOnFocus: false,
    },
  );
  const limit = widget.span === 2 ? 10 : 7;
  const items = data?.slice(0, limit) ?? [];
  return (
    <WidgetFrame
      label="News"
      className="desk-news"
      subtitle={scope}
      ask={`Summarise the news that matters for ${symbols.join(", ") || "my holdings"} and the likely impact on my positions.`}
      foot={
        <>
          <span>Yahoo Finance headlines · newest first</span>
          {items[0]?.time ? (
            <Stamp ms={items[0].time * 1000} prefix="Latest" />
          ) : null}
        </>
      }
    >
      <Failure error={error} retry={mutate} />
      {symbols.length === 0 ? (
        <DeskEmpty
          title="Nothing to follow yet"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenView({ view: "watchlists" })}
            >
              Add to a watchlist
            </Button>
          }
        >
          Headlines follow your holdings, or your first watchlist.
        </DeskEmpty>
      ) : isLoading || (!pinned && holdings.loading) ? (
        <SkeletonRows rows={limit} label="Loading headlines" />
      ) : items.length ? (
        <ul className="ruled-list desk-headlines">
          {items.map((item) => (
            <li key={`${item.symbol}:${item.url}`}>
              <SourceLink href={item.url}>{item.title}</SourceLink>
              <span className="meta">
                <SymbolButton symbol={item.symbol} onOpen={onOpenSymbol} />
                {" · "}
                {item.publisher}
                {item.time ? (
                  <>
                    {" · "}
                    <Stamp ms={item.time * 1000} />
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : !error ? (
        <DeskEmpty title="No recent headlines">
          Pin specific symbols to this widget in edit mode.
        </DeskEmpty>
      ) : null}
    </WidgetFrame>
  );
}

export function AlertsWidget({ widget, ctx }: WidgetProps<"alerts">) {
  const { workspace, refresh, onOpenSymbol, onOpenView } = ctx;
  const now = useNow();
  const active = workspace.alerts.filter((alert) => alert.enabled);
  const weekAgo = now ? now - 7 * 86_400_000 : Infinity;
  const triggered = workspace.alerts
    .filter(
      (alert) =>
        alert.lastTriggered && Date.parse(alert.lastTriggered) >= weekAgo,
    )
    .toSorted(
      (a, b) =>
        Date.parse(b.lastTriggered ?? "") - Date.parse(a.lastTriggered ?? ""),
    );
  const { data, error, mutate, isLoading } = useQuotes(
    active.map((alert) => alert.symbol),
    refresh,
  );
  const bySymbol = new Map(data?.quotes.map((quote) => [quote.symbol, quote]));
  const ranked = active
    .map((alert) => {
      const price = bySymbol.get(alert.symbol)?.price;
      return {
        ...alert,
        price,
        distance: price ? (alert.target / price - 1) * 100 : null,
      };
    })
    .toSorted(
      (a, b) =>
        Math.abs(a.distance ?? Infinity) - Math.abs(b.distance ?? Infinity),
    );
  const limit = widget.span === 2 ? 10 : 6;
  return (
    <WidgetFrame
      label="Alerts"
      className="desk-alerts"
      subtitle={`${active.length} active · ${triggered.length} triggered this week`}
      ask="Review my price alerts: which are close to triggering, and are the levels still sensible given recent price action?"
      actions={
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onOpenView({ view: "alerts" })}
        >
          Manage
        </Button>
      }
      foot={
        <>
          <span>{data?.source ?? "Market data"} · nearest target first</span>
          <span>Checked every two minutes when monitoring is on</span>
        </>
      }
    >
      <Failure error={error} retry={mutate} />
      {active.length === 0 && triggered.length === 0 ? (
        <DeskEmpty
          title="No alerts set"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenView({ view: "alerts" })}
            >
              Create an alert
            </Button>
          }
        >
          Set a price level and it is tracked here.
        </DeskEmpty>
      ) : isLoading ? (
        <SkeletonRows
          rows={Math.min(limit, active.length + triggered.length)}
        />
      ) : (
        <>
          {triggered.length ? (
            <>
              <span className="kicker">Triggered</span>
              <ul className="ruled-list desk-alert-list">
                {triggered.slice(0, 4).map((alert) => (
                  <li key={alert.id} className="desk-line">
                    <SymbolButton symbol={alert.symbol} onOpen={onOpenSymbol} />
                    <span className="muted">
                      {alert.direction} {amount(alert.target)} hit at{" "}
                      {amount(alert.triggeredPrice)}
                    </span>
                    {alert.lastTriggered ? (
                      <span className="meta">
                        <Stamp ms={Date.parse(alert.lastTriggered)} />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {ranked.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Active</th>
                  <th>Rule</th>
                  <th className="num">Last</th>
                  <th className="num">To target</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, limit).map((alert) => (
                  <tr key={alert.id}>
                    <td>
                      <SymbolButton
                        symbol={alert.symbol}
                        onOpen={onOpenSymbol}
                      />
                    </td>
                    <td className="muted">
                      {alert.direction} {amount(alert.target)}
                    </td>
                    <td className="num">{amount(alert.price)}</td>
                    <td className="num">
                      {alert.distance == null
                        ? "—"
                        : `${alert.distance > 0 ? "+" : ""}${amount(alert.distance)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </WidgetFrame>
  );
}

export function InsightWidget({ widget, ctx }: WidgetProps<"insight">) {
  return (
    <WidgetFrame
      label="Note"
      className="desk-insight"
      subtitle={widget.title}
      ask={`Revisit the pinned insight "${widget.title}". Is it still valid given the latest data?`}
      actions={
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss insight"
          title="Dismiss"
          onClick={() => void ctx.remove()}
        >
          <X />
        </Button>
      }
      foot={
        <>
          <span>Pinned note · verify before acting</span>
          <Stamp ms={Date.parse(widget.createdAt)} prefix="Pinned" />
        </>
      }
    >
      {widget.symbols.length ? (
        <div className="desk-chips">
          {widget.symbols.map((symbol) => (
            <button
              key={symbol}
              type="button"
              className="chip"
              onClick={() => ctx.onOpenSymbol(symbol)}
            >
              {symbol}
            </button>
          ))}
        </div>
      ) : null}
      <div className="desk-brief-body desk-insight-body">
        <Streamdown mode="static" components={markdownComponents}>
          {widget.body}
        </Streamdown>
      </div>
    </WidgetFrame>
  );
}
