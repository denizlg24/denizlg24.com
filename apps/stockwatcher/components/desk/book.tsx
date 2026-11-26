"use client";

import { Button } from "@/components/ui/button";
import { Change, Failure, Tick } from "@/components/shared";
import { useQuotes } from "@/components/market-widgets";
import type { Quote } from "@/lib/models";
import { amount, compact, number, tone } from "@/lib/utils";
import { firstWatchlist, useHoldings } from "./data";
import { ListFreshness } from "@/components/freshness";
import {
  DeskEmpty,
  SkeletonRows,
  SymbolButton,
  WidgetFrame,
  latestTime,
  type WidgetProps,
} from "./frame";

const signed = (value: number | null | undefined) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${amount(value)}`;
const signedCompact = (value: number | null | undefined) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${compact(value)}`;

export function HoldingsWidget({ widget, ctx }: WidgetProps<"holdings">) {
  const { workspace, refresh, onOpenSymbol, onOpenView } = ctx;
  const book = workspace.books.find((item) => item.id === widget.bookId);
  const { rows, totals, ledgerError, quotes, loading } = useHoldings(
    workspace,
    refresh,
    book?.id,
  );
  const wide = widget.span === 2;
  const limit = wide ? 14 : 9;
  const money = wide ? amount : compact;
  const signedMoney = wide ? signed : signedCompact;
  const asOf = latestTime(rows.map((row) => row.quote?.time ?? 0));
  const scope = book ? book.name : "All books";
  return (
    <WidgetFrame
      label="Holdings"
      className="desk-holdings"
      subtitle={`${scope} · ${rows.length} open position${rows.length === 1 ? "" : "s"}`}
      ask={`Review my holdings (${scope}): concentration, today's biggest contributors and detractors, and anything that needs attention.`}
      actions={
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onOpenView({ view: "portfolio" })}
        >
          Portfolio
        </Button>
      }
      foot={
        <>
          <span>
            {quotes.data?.source ?? "Market data"} · valued at last trade, per
            currency
          </span>
          <ListFreshness
            symbols={refresh ? rows.map((row) => row.symbol) : []}
            ms={asOf}
          />
        </>
      }
    >
      <Failure error={ledgerError} />
      <Failure error={quotes.error} retry={quotes.mutate} />
      {loading ? (
        <SkeletonRows rows={6} label="Valuing holdings" />
      ) : rows.length === 0 ? (
        <DeskEmpty
          title="No open positions"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenView({ view: "portfolio" })}
            >
              Record a buy
            </Button>
          }
        >
          Record a transaction and it is valued here at live prices.
        </DeskEmpty>
      ) : (
        <>
          <div className="desk-totals">
            {totals.map((total) => {
              const dayBase = total.value - total.day;
              return (
                <div className="figure" key={total.currency}>
                  <span className="figure-label">Value · {total.currency}</span>
                  <strong className="figure-value">
                    {amount(total.value)}
                  </strong>
                  <span className="figure-sub">
                    <span className={tone(total.day)}>
                      {signed(total.day)}
                      {dayBase
                        ? ` (${total.day > 0 ? "+" : ""}${amount((total.day / dayBase) * 100)}%)`
                        : ""}
                    </span>{" "}
                    day
                  </span>
                  <span className="figure-sub">
                    <span className={tone(total.unrealized)}>
                      {signed(total.unrealized)}
                    </span>{" "}
                    unrealized
                    {total.unpriced ? ` · ${total.unpriced} unpriced` : ""}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="desk-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  {wide ? <th className="num">Qty</th> : null}
                  <th className="num">Last</th>
                  <th className="num">Day</th>
                  <th className="num">Value</th>
                  <th className="num">{wide ? "Unrl. P/L" : "Unrl."}</th>
                  <th className="num">Wt</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((row) => (
                  <tr key={`${row.symbol}:${row.currency}`}>
                    <td>
                      <SymbolButton symbol={row.symbol} onOpen={onOpenSymbol} />
                    </td>
                    {wide ? (
                      <td className="num">{number(row.quantity)}</td>
                    ) : null}
                    <td className="num">
                      <Tick value={row.price} />{" "}
                      <span className="desk-ccy">{row.currency}</span>
                    </td>
                    <td className="num">
                      <Change value={row.dayPercent} />
                    </td>
                    <td className="num">{money(row.marketValue)}</td>
                    <td className={`num ${tone(row.unrealized)}`}>
                      {signedMoney(row.unrealized)}
                    </td>
                    <td className="num muted">
                      {row.weight == null ? "—" : `${row.weight.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > limit ? (
            <button
              type="button"
              className="desk-more"
              onClick={() => onOpenView({ view: "portfolio" })}
            >
              {rows.length - limit} more positions in Portfolio
            </button>
          ) : null}
        </>
      )}
    </WidgetFrame>
  );
}

type Mover = { symbol: string; name?: string; quote: Quote };

export function MoversWidget({ widget, ctx }: WidgetProps<"movers">) {
  const { workspace, refresh, onOpenSymbol, onOpenView } = ctx;
  const holdings = useHoldings(workspace, refresh);
  const list = firstWatchlist(workspace);
  const watchSymbols =
    widget.source === "watchlist" ? (list?.symbols ?? []) : [];
  const watchQuotes = useQuotes(watchSymbols, refresh);
  const fromHoldings = widget.source === "holdings";
  const source = fromHoldings ? holdings.quotes : watchQuotes;
  const movers: Mover[] = fromHoldings
    ? holdings.rows.flatMap((row) =>
        row.quote ? [{ symbol: row.symbol, quote: row.quote }] : [],
      )
    : (watchQuotes.data?.quotes ?? []).map((quote) => ({
        symbol: quote.symbol,
        quote,
      }));
  const ranked = movers
    .filter((item) => item.quote.percent != null)
    .toSorted((a, b) => (b.quote.percent ?? 0) - (a.quote.percent ?? 0));
  const count = widget.span === 2 ? 6 : 4;
  const gainers = ranked.filter((item) => (item.quote.percent ?? 0) > 0);
  const losers = ranked
    .filter((item) => (item.quote.percent ?? 0) < 0)
    .toReversed();
  const universeSize = fromHoldings
    ? holdings.rows.length
    : watchSymbols.length;
  const scope = fromHoldings ? "Holdings" : (list?.name ?? "Watchlist");
  const asOf = latestTime(movers.map((item) => item.quote.time));
  const loading = fromHoldings ? holdings.loading : watchQuotes.isLoading;
  const top = [...gainers.slice(0, 2), ...losers.slice(0, 2)]
    .map((item) => item.symbol)
    .join(", ");
  return (
    <WidgetFrame
      label="Movers"
      className="desk-movers"
      subtitle={`${scope} · day change vs prior close`}
      ask={`Why are my biggest movers moving today${top ? ` (${top})` : ""}? Check news and say whether anything changes the thesis.`}
      foot={
        <>
          <span>
            {source.data?.source ?? "Market data"} · {universeSize} symbols
            ranked
          </span>
          <ListFreshness
            symbols={refresh ? movers.map((item) => item.symbol) : []}
            ms={asOf}
          />
        </>
      }
    >
      <Failure error={source.error} retry={source.mutate} />
      {loading ? (
        <SkeletonRows rows={count} label="Ranking movers" />
      ) : universeSize === 0 ? (
        <DeskEmpty
          title={fromHoldings ? "No open positions" : "Watchlist is empty"}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onOpenView({
                  view: fromHoldings ? "portfolio" : "watchlists",
                })
              }
            >
              {fromHoldings ? "Record a transaction" : "Add symbols"}
            </Button>
          }
        />
      ) : (
        <div className="desk-split">
          <MoverColumn
            title="Gainers"
            items={gainers.slice(0, count)}
            onOpenSymbol={onOpenSymbol}
          />
          <MoverColumn
            title="Losers"
            items={losers.slice(0, count)}
            onOpenSymbol={onOpenSymbol}
          />
        </div>
      )}
    </WidgetFrame>
  );
}

function MoverColumn({
  title,
  items,
  onOpenSymbol,
}: {
  title: string;
  items: Mover[];
  onOpenSymbol: (symbol: string) => void;
}) {
  return (
    <div>
      <span className="kicker">{title}</span>
      {items.length ? (
        <ul className="ruled-list">
          {items.map((item) => (
            <li key={item.symbol} className="desk-line">
              <SymbolButton symbol={item.symbol} onOpen={onOpenSymbol} />
              <span className="num muted">
                {amount(item.quote.price)}
                <span className="desk-ccy"> {item.quote.currency}</span>
              </span>
              <Change value={item.quote.percent} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta desk-none">None today</p>
      )}
    </div>
  );
}
