"use client";

import { useMemo, useState, type CSSProperties } from "react";
import useSWR from "swr";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, Change, Empty, Failure, Loading, Tick } from "@/components/shared";
import { useQuotes } from "@/components/market-widgets";
import { Freshness } from "@/components/freshness";
import type { Quote } from "@/lib/models";
import { correlationMatrix } from "@/lib/analytics";
import { downloadCsv } from "@/lib/export";
import { symbolPattern } from "@/lib/universes";
import { amount, number, percent, tone } from "@/lib/utils";
import { useHistory } from "./quant";

const heat = (value: number | null | undefined) => {
  if (value == null) return "";
  if (value >= 3) return "heat-gain-strong";
  if (value >= 1) return "heat-gain";
  if (value > 0) return "heat-gain-soft";
  if (value <= -3) return "heat-loss-strong";
  if (value <= -1) return "heat-loss";
  if (value < 0) return "heat-loss-soft";
  return "";
};
const fxHeat = (move: number | null) => {
  if (move == null || Math.abs(move) < 0.05) return "";
  const side = move > 0 ? "gain" : "loss";
  const size = Math.abs(move);
  return size >= 0.8 ? `heat-${side}-strong` : size >= 0.3 ? `heat-${side}` : `heat-${side}-soft`;
};
const yearStart = () => `${new Date().getFullYear()}-01-01`;
const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };

/* Generic quote board: CMDTY, CRYP */
export type BoardGroup = { title: string; items: readonly (readonly [string, string, string?])[] };

export const commodityBoard: BoardGroup[] = [
  {
    title: "Energy",
    items: [
      ["CL=F", "WTI crude", "USD/bbl"],
      ["BZ=F", "Brent crude", "USD/bbl"],
      ["NG=F", "Natural gas", "USD/MMBtu"],
      ["RB=F", "RBOB gasoline", "USD/gal"],
      ["HO=F", "Heating oil", "USD/gal"],
    ],
  },
  {
    title: "Metals",
    items: [
      ["GC=F", "Gold", "USD/oz"],
      ["SI=F", "Silver", "USD/oz"],
      ["PL=F", "Platinum", "USD/oz"],
      ["PA=F", "Palladium", "USD/oz"],
      ["HG=F", "Copper", "USD/lb"],
      ["ALI=F", "Aluminium", "USD/t"],
    ],
  },
  {
    title: "Agriculture",
    items: [
      ["ZC=F", "Corn", "USc/bu"],
      ["ZW=F", "Wheat", "USc/bu"],
      ["ZS=F", "Soybeans", "USc/bu"],
      ["KC=F", "Coffee", "USc/lb"],
      ["SB=F", "Sugar No.11", "USc/lb"],
      ["CC=F", "Cocoa", "USD/t"],
      ["CT=F", "Cotton", "USc/lb"],
      ["LE=F", "Live cattle", "USc/lb"],
      ["HE=F", "Lean hogs", "USc/lb"],
    ],
  },
];

export const cryptoBoard: BoardGroup[] = [
  {
    title: "Large caps",
    items: [
      ["BTC-USD", "Bitcoin"],
      ["ETH-USD", "Ether"],
      ["SOL-USD", "Solana"],
      ["XRP-USD", "XRP"],
      ["BNB-USD", "BNB"],
      ["ADA-USD", "Cardano"],
      ["DOGE-USD", "Dogecoin"],
      ["AVAX-USD", "Avalanche"],
      ["LINK-USD", "Chainlink"],
      ["DOT-USD", "Polkadot"],
      ["LTC-USD", "Litecoin"],
    ],
  },
  {
    title: "Listed proxies",
    items: [
      ["IBIT", "iShares Bitcoin Trust"],
      ["ETHA", "iShares Ethereum Trust"],
      ["MSTR", "Strategy"],
      ["COIN", "Coinbase"],
    ],
  },
];

export function QuoteBoard({
  groups,
  refresh,
  select,
  source,
}: {
  groups: BoardGroup[];
  refresh: boolean;
  select: (symbol: string) => void;
  source: string;
}) {
  const symbols = groups.flatMap((group) => group.items.map(([symbol]) => symbol));
  const { data, error, isLoading, mutate } = useQuotes(symbols, refresh);
  const { data: ytd } = useSWR<{ quotes: Quote[] }>(
    `/api/market?${new URLSearchParams({ symbols: symbols.join(","), since: yearStart() })}`,
    api,
    { errorRetryCount: 1, revalidateOnFocus: false },
  );
  const quotes = new Map(data?.quotes.map((quote) => [quote.symbol, quote]));
  const year = new Map(ytd?.quotes.map((quote) => [quote.symbol, quote.periodPercent]));
  if (error) return <Failure error={error} retry={() => void mutate()} />;
  if (isLoading) return <Loading />;
  return (
    <div className="term-stack">
      <div className="desk-table-wrap">
        <table className="data-table term-table monitor-table">
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Ticker</th>
              <th className="num">Last</th>
              <th className="num">Net</th>
              <th className="num">%Chg</th>
              <th className="num">YTD</th>
              <th className="num">Day range</th>
              <th className="num">52W range</th>
              <th>Unit</th>
              <th className="num">Time</th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.title}>
              <tr className="group-row">
                <th colSpan={10}>{group.title}</th>
              </tr>
              {group.items.map(([symbol, label, unit]) => {
                const quote = quotes.get(symbol);
                const position =
                  quote?.yearHigh != null && quote.yearLow != null && quote.yearHigh > quote.yearLow
                    ? ((quote.price - quote.yearLow) / (quote.yearHigh - quote.yearLow)) * 100
                    : null;
                return (
                  <tr key={symbol}>
                    <td>
                      <button type="button" className="security-link" onClick={() => select(symbol)}>
                        {label}
                      </button>
                    </td>
                    <td className="security-code">{symbol}</td>
                    <td className="num">
                      <Tick value={quote?.price} />
                    </td>
                    <td className={`num ${tone(quote?.change)}`}>{amount(quote?.change)}</td>
                    <td className={`num heat-cell ${heat(quote?.percent)}`}>
                      <Change value={quote?.percent} />
                    </td>
                    <td className="num">
                      <Change value={year.get(symbol)} />
                    </td>
                    <td className="num muted">
                      {quote?.low != null ? `${amount(quote.low)}–${amount(quote.high)}` : "—"}
                    </td>
                    <td className="num">
                      {position != null ? (
                        <span className="range-bar" title={`${amount(quote?.yearLow)} – ${amount(quote?.yearHigh)}`}>
                          <i style={{ left: `${Math.min(100, Math.max(0, position))}%` }} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="muted">{unit ?? quote?.currency ?? ""}</td>
                    <td className="num">
                      <Freshness symbol={symbol} quoteMs={quote ? quote.time * 1000 : null} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <p className="term-source">{source}</p>
    </div>
  );
}

/* FXC · currency cross-rate matrix */
const currencies = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "HKD", "SEK", "NOK", "MXN", "BRL"] as const;

export function CrossRates({ select }: { select: (symbol: string) => void }) {
  const [shown, setShown] = useState<string[]>(["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY"]);
  const pairs = shown.filter((code) => code !== "USD").map((code) => `${code}USD=X`);
  const { data, error, isLoading, mutate } = useQuotes(pairs, true);
  const usd = new Map<string, { now: number; prior: number | null }>([["USD", { now: 1, prior: 1 }]]);
  for (const quote of data?.quotes ?? [])
    usd.set(quote.symbol.slice(0, 3), { now: quote.price, prior: quote.previous });
  if (error) return <Failure error={error} retry={() => void mutate()} />;
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="fx-picker" role="group" aria-label="Currencies">
          {currencies.map((code) => (
            <button
              key={code}
              type="button"
              className="chip"
              aria-pressed={shown.includes(code)}
              onClick={() =>
                setShown(
                  shown.includes(code)
                    ? shown.filter((item) => item !== code)
                    : currencies.filter((item) => item === code || shown.includes(item)),
                )
              }
            >
              {code}
            </button>
          ))}
        </div>
        <span className="term-source">Row currency priced in column currency · cell shade is today&apos;s move</span>
      </div>
      {isLoading ? (
        <Loading />
      ) : (
        <div className="desk-table-wrap">
          <table className="data-table term-table fx-matrix">
            <thead>
              <tr>
                <th />
                {shown.map((code) => (
                  <th key={code} className="num">
                    {code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row}>
                  <th>{row}</th>
                  {shown.map((column) => {
                    if (row === column) return <td key={column} className="fx-self" />;
                    const a = usd.get(row);
                    const b = usd.get(column);
                    if (!a || !b) return <td key={column} className="num muted">—</td>;
                    const rate = a.now / b.now;
                    const prior = a.prior && b.prior ? a.prior / b.prior : null;
                    const move = prior ? (rate / prior - 1) * 100 : null;
                    const symbol = column === "USD" ? `${row}USD=X` : row === "USD" ? `USD${column}=X` : `${row}${column}=X`;
                    return (
                      <td key={column} className={`num heat-cell ${fxHeat(move)}`} title={`${row}/${column} ${percent(move)}`}>
                        <button type="button" className="fx-cell" onClick={() => select(symbol)}>
                          <span>{rate >= 100 ? rate.toFixed(2) : rate >= 1 ? rate.toFixed(4) : rate.toFixed(5)}</span>
                          <small className={tone(move)}>{move == null ? "" : `${move > 0 ? "+" : ""}${move.toFixed(2)}`}</small>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="term-source">Crosses derived from each currency&apos;s USD rate · Yahoo Finance FX quotes · click a cell for its chart.</p>
    </div>
  );
}

/* CORR · correlation matrix */
const presets: Record<string, string[]> = {
  "Cross-asset": ["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "HYG", "GLD", "USO", "UUP", "BTC-USD"],
  "Mega caps": ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "BRK-B", "JPM"],
  "US sectors": ["XLK", "XLF", "XLV", "XLY", "XLP", "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC"],
  "Global indices": ["^GSPC", "^STOXX50E", "^FTSE", "^GDAXI", "^N225", "^HSI", "^NSEI", "^BVSP"],
};

const corrStyle = (value: number | null): CSSProperties | undefined => {
  if (value == null) return undefined;
  const strength = Math.round(Math.min(1, Math.abs(value)) * 70);
  return {
    background: `color-mix(in srgb, ${value >= 0 ? "var(--chart-3)" : "var(--loss)"} ${strength}%, var(--card))`,
    color: strength > 45 ? "var(--card)" : undefined,
  };
};

export function Correlation({ select, initial }: { select: (symbol: string) => void; initial?: string[] }) {
  const [symbols, setSymbols] = useState<string[]>(initial?.length ? initial.slice(0, 20) : presets["Cross-asset"]);
  const [text, setText] = useState("");
  const [years, setYears] = useState(1);
  const { data, error, isLoading, mutate } = useHistory(symbols, years);
  const series = useMemo(
    () => symbols.flatMap((symbol) => data?.series.find((item) => item.symbol === symbol) ?? []),
    [data, symbols],
  );
  const result = useMemo(() => (series.length > 1 ? correlationMatrix(series) : null), [series]);
  const [hover, setHover] = useState<[number, number] | null>(null);
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="row-actions">
          <select
            className="studio-select"
            aria-label="Preset"
            value=""
            onChange={(event) => event.target.value && setSymbols(presets[event.target.value])}
          >
            <option value="">Preset…</option>
            {Object.keys(presets).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const added = text.toUpperCase().split(/[\s,]+/).filter((item) => symbolPattern.test(item));
              setSymbols([...new Set([...symbols, ...added])].slice(0, 30));
              setText("");
            }}
          >
            <input
              className="studio-select"
              placeholder="Add tickers"
              value={text}
              maxLength={120}
              onChange={(event) => setText(event.target.value.toUpperCase())}
              aria-label="Add tickers"
            />
          </form>
          <div className="seg" role="group" aria-label="Look-back">
            {[0.25, 0.5, 1, 3, 5].map((value) => (
              <button key={value} type="button" aria-pressed={years === value} onClick={() => setYears(value)}>
                {value < 1 ? `${value * 12}M` : `${value}Y`}
              </button>
            ))}
          </div>
        </div>
        {result ? (
          <button
            type="button"
            className="chip"
            onClick={() =>
              downloadCsv(
                series.map((item, i) => ({
                  symbol: item.symbol,
                  ...Object.fromEntries(series.map((other, j) => [other.symbol, result.matrix[i][j]?.toFixed(4) ?? ""])),
                })),
                "correlation-matrix",
              )
            }
          >
            Export CSV
          </button>
        ) : null}
      </div>
      {error ? <Failure error={error} retry={() => void mutate()} /> : null}
      {isLoading && !data ? (
        <Loading message="Loading history" />
      ) : !result ? (
        <Empty title="Add at least two tickers" />
      ) : (
        <div className="desk-table-wrap">
          <table className="data-table term-table corr-matrix" onMouseLeave={() => setHover(null)}>
            <thead>
              <tr>
                <th />
                {series.map((item, j) => (
                  <th key={item.symbol} className="num" data-hover={hover?.[1] === j || undefined}>
                    {item.symbol}
                  </th>
                ))}
                <th className="num">Vol</th>
                <th className="num">Return</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {series.map((item, i) => (
                <tr key={item.symbol}>
                  <th data-hover={hover?.[0] === i || undefined}>
                    <button type="button" className="security-link" onClick={() => select(item.symbol)} title={item.name ?? item.symbol}>
                      {item.symbol}
                    </button>
                  </th>
                  {series.map((other, j) => (
                    <td
                      key={other.symbol}
                      className="num"
                      style={i === j ? undefined : corrStyle(result.matrix[i][j])}
                      onMouseEnter={() => setHover([i, j])}
                      title={`${item.symbol} / ${other.symbol}: ${number(result.matrix[i][j])}`}
                    >
                      {i === j ? "1" : result.matrix[i][j]?.toFixed(2)}
                    </td>
                  ))}
                  <td className="num">{result.vol[i].toFixed(1)}%</td>
                  <td className={`num ${tone(result.total[i])}`}>{percent(result.total[i])}</td>
                  <td>
                    <button
                      type="button"
                      className="corr-remove"
                      aria-label={`Remove ${item.symbol}`}
                      onClick={() => setSymbols(symbols.filter((symbol) => symbol !== item.symbol))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="term-source">
        Pearson correlation of daily total returns on {result?.observations ?? 0} common trading days
        {data?.missing.length ? ` · no data for ${data.missing.join(", ")}` : ""}. Vol is annualised.
      </p>
    </div>
  );
}

/* GC · US Treasury curve */
const tenors = [
  { symbol: "^IRX", label: "3M", years: 0.25 },
  { symbol: "2YY=F", label: "2Y", years: 2 },
  { symbol: "^FVX", label: "5Y", years: 5 },
  { symbol: "^TNX", label: "10Y", years: 10 },
  { symbol: "^TYX", label: "30Y", years: 30 },
] as const;
const lookbacks = [
  { key: "now", label: "Today", days: 0, color: "var(--term-header)" },
  { key: "w1", label: "1W ago", days: 7, color: "var(--chart-5)" },
  { key: "m1", label: "1M ago", days: 30, color: "var(--chart-3)" },
  { key: "y1", label: "1Y ago", days: 365, color: "var(--muted-foreground)" },
] as const;

export function YieldCurve() {
  const { data, error, isLoading, mutate } = useHistory(
    tenors.map((tenor) => tenor.symbol),
    3,
  );
  const series = useMemo(
    () => new Map(data?.series.map((item) => [item.symbol, item.points])),
    [data],
  );
  const at = (symbol: string, daysAgo: number) => {
    const points = series.get(symbol) ?? [];
    if (!points.length) return null;
    const cutoff = points.at(-1)!.time - daysAgo * 86400;
    return points.findLast((point) => point.time <= cutoff)?.close ?? null;
  };
  const curve = tenors.map((tenor) => ({
    tenor: tenor.label,
    ...Object.fromEntries(lookbacks.map((look) => [look.key, at(tenor.symbol, look.days)])),
  }));
  const spreads = useMemo(() => {
    const two = new Map((series.get("2YY=F") ?? []).map((point) => [Math.floor(point.time / 86400), point.close]));
    const three = new Map((series.get("^IRX") ?? []).map((point) => [Math.floor(point.time / 86400), point.close]));
    return (series.get("^TNX") ?? []).flatMap((point) => {
      const day = Math.floor(point.time / 86400);
      const a = two.get(day);
      const b = three.get(day);
      return a == null && b == null
        ? []
        : [
            {
              time: point.time,
              s2s10: a == null ? null : (point.close - a) * 100,
              s3m10: b == null ? null : (point.close - b) * 100,
            },
          ];
    });
  }, [series]);
  if (error) return <Failure error={error} retry={() => void mutate()} />;
  if (isLoading && !data) return <Loading message="Loading yields" />;
  const latest = {
    s2s10: spreads.findLast((row) => row.s2s10 != null)?.s2s10 ?? null,
    s3m10: spreads.findLast((row) => row.s3m10 != null)?.s3m10 ?? null,
  };
  return (
    <div className="term-stack">
      <div className="quant-split">
        <div>
          <div className="quant-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curve} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--rule)" vertical={false} />
                <XAxis dataKey="tenor" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis width={44} tick={axisTick} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={["auto", "auto"]} axisLine={false} tickLine={false} />
                <Tooltip
                  isAnimationActive={false}
                  formatter={(value) => (typeof value === "number" ? `${value.toFixed(3)}%` : value)}
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--strong-border)", fontSize: 12 }}
                />
                {lookbacks.map((look) => (
                  <Line
                    key={look.key}
                    dataKey={look.key}
                    name={look.label}
                    stroke={look.color}
                    strokeWidth={look.key === "now" ? 2.2 : 1.2}
                    strokeDasharray={look.key === "y1" ? "4 3" : undefined}
                    dot={{ r: look.key === "now" ? 3 : 2 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="quant-legend">
            {lookbacks.map((look) => (
              <li key={look.key} style={{ color: look.color }}>
                {look.label}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="quant-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={spreads} margin={{ top: 12, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--rule)" vertical={false} />
                <XAxis
                  dataKey="time"
                  tick={axisTick}
                  minTickGap={50}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" }).format(v * 1000)}
                />
                <YAxis orientation="right" width={44} tick={axisTick} tickFormatter={(v: number) => `${v.toFixed(0)}`} axisLine={false} tickLine={false} />
                <ReferenceLine y={0} stroke="var(--loss)" strokeDasharray="3 3" />
                <Tooltip
                  isAnimationActive={false}
                  labelFormatter={(v) => (typeof v === "number" ? new Date(v * 1000).toISOString().slice(0, 10) : String(v))}
                  formatter={(value) => (typeof value === "number" ? `${value.toFixed(0)} bp` : value)}
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--strong-border)", fontSize: 12 }}
                />
                <Line dataKey="s2s10" name="2s10s" stroke="var(--term-header)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                <Line dataKey="s3m10" name="3m10y" stroke="var(--chart-3)" dot={false} strokeWidth={1.1} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <ul className="quant-legend">
            <li style={{ color: "var(--term-header)" }}>2s10s {latest?.s2s10 != null ? `${latest.s2s10.toFixed(0)} bp` : ""}</li>
            <li style={{ color: "var(--chart-3)" }}>3m10y {latest?.s3m10 != null ? `${latest.s3m10.toFixed(0)} bp` : ""}</li>
          </ul>
        </div>
      </div>
      <div className="desk-table-wrap">
        <table className="data-table term-table">
          <thead>
            <tr>
              <th>Tenor</th>
              {lookbacks.map((look) => (
                <th key={look.key} className="num">
                  {look.label}
                </th>
              ))}
              <th className="num">1D bp</th>
              <th className="num">1M bp</th>
              <th className="num">1Y bp</th>
            </tr>
          </thead>
          <tbody>
            {tenors.map((tenor) => {
              const now = at(tenor.symbol, 0);
              const change = (days: number) => {
                const then = at(tenor.symbol, days);
                return now != null && then != null ? (now - then) * 100 : null;
              };
              const bp = (value: number | null) => (
                <td className={`num ${tone(value)}`}>{value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}`}</td>
              );
              return (
                <tr key={tenor.symbol}>
                  <th>
                    {tenor.label} <small className="muted">{tenor.symbol}</small>
                  </th>
                  {lookbacks.map((look) => {
                    const value = at(tenor.symbol, look.days);
                    return (
                      <td key={look.key} className="num">
                        {value == null ? "—" : `${value.toFixed(3)}%`}
                      </td>
                    );
                  })}
                  {bp(change(1))}
                  {bp(change(30))}
                  {bp(change(365))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="term-source">
        US Treasury yields from CBOE yield indices (3M, 5Y, 10Y, 30Y) and the CME 2-year yield future, via Yahoo Finance daily closes. Spreads in basis points.
      </p>
    </div>
  );
}
