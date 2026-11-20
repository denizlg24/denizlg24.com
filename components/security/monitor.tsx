"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, Change, Empty, Failure, Loading, Tick } from "@/components/shared";
import { useQuotes } from "@/components/market-widgets";
import { Freshness } from "@/components/freshness";
import type { Quote } from "@/lib/models";
import type {
  MacroCatalog,
  MacroHistory,
  Movers,
} from "@/lib/security-types";
import { monitorFunctions, type MonitorFunction } from "@/lib/terminal";
import {
  Correlation,
  CrossRates,
  QuoteBoard,
  YieldCurve,
  commodityBoard,
  cryptoBoard,
} from "./boards";
import { Screener } from "./screener";
import { Rotation } from "./rotation";
import { amount, compact, number, tone } from "@/lib/utils";

const heat = (value: number | null | undefined) => {
  if (value == null) return undefined;
  if (value >= 3) return "heat-gain-strong";
  if (value >= 1) return "heat-gain";
  if (value > 0) return "heat-gain-soft";
  if (value <= -3) return "heat-loss-strong";
  if (value <= -1) return "heat-loss";
  if (value < 0) return "heat-loss-soft";
  return undefined;
};

const moverTabs = [
  ["gainers", "Gainers"],
  ["losers", "Losers"],
  ["actives", "Most active"],
] as const;

function MostActive({ select }: { select: (symbol: string) => void }) {
  const [list, setList] = useState<(typeof moverTabs)[number][0]>("gainers");
  const { data, error, isLoading, mutate } = useSWR<Movers>(
    `/api/security?movers=${list}`,
    api,
    { refreshInterval: 120_000, errorRetryCount: 1 },
  );
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="seg" role="group" aria-label="Movers list">
          {moverTabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={list === key}
              onClick={() => setList(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="term-source">
          US listings · Yahoo screener via markets relay
          {data?.freshness.stale ? " · stale" : ""}
        </span>
      </div>
      <Failure error={error} retry={() => void mutate()} />
      {isLoading ? (
        <Loading />
      ) : data?.quotes.length ? (
        <div className="desk-table-wrap">
          <table className="data-table term-table monitor-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Ticker</th>
                <th>Name</th>
                <th className="num">Last</th>
                <th className="num">Net</th>
                <th className="num">%Chg</th>
                <th className="num">Volume</th>
                <th className="num" title="Volume relative to its average">
                  Rel vol
                </th>
                <th className="num">Mkt cap</th>
              </tr>
            </thead>
            <tbody>
              {data.quotes.map((row, i) => {
                const relative =
                  row.volume != null && row.averageVolume
                    ? row.volume / row.averageVolume
                    : null;
                return (
                  <tr key={row.ticker}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <button
                        type="button"
                        className="security-link"
                        onClick={() => select(row.ticker)}
                      >
                        {row.ticker}
                      </button>
                    </td>
                    <td className="desk-name">{row.name}</td>
                    <td className="num">{amount(row.last)}</td>
                    <td className={`num ${tone(row.change)}`}>
                      {amount(row.change)}
                    </td>
                    <td className={`num heat-cell ${heat(row.percent) ?? ""}`}>
                      <Change value={row.percent} />
                    </td>
                    <td className="num">{compact(row.volume)}</td>
                    <td
                      className={`num ${relative != null && relative >= 2 ? "term-key" : ""}`}
                    >
                      {relative == null ? "—" : `${number(relative)}x`}
                    </td>
                    <td className="num">{compact(row.marketCap)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : !error ? (
        <Empty title="No movers returned" />
      ) : null}
    </div>
  );
}

const worldIndices = [
  {
    region: "Americas",
    items: [
      ["^GSPC", "S&P 500"],
      ["^DJI", "Dow Jones"],
      ["^IXIC", "Nasdaq Composite"],
      ["^RUT", "Russell 2000"],
      ["^VIX", "VIX"],
      ["^GSPTSE", "S&P/TSX"],
      ["^BVSP", "Ibovespa"],
      ["^MXX", "IPC Mexico"],
    ],
  },
  {
    region: "EMEA",
    items: [
      ["^STOXX50E", "Euro Stoxx 50"],
      ["^FTSE", "FTSE 100"],
      ["^GDAXI", "DAX"],
      ["^FCHI", "CAC 40"],
      ["^IBEX", "IBEX 35"],
      ["FTSEMIB.MI", "FTSE MIB"],
      ["^AEX", "AEX"],
      ["^SSMI", "SMI"],
      ["PSI20.LS", "PSI"],
    ],
  },
  {
    region: "Asia/Pacific",
    items: [
      ["^N225", "Nikkei 225"],
      ["^HSI", "Hang Seng"],
      ["000001.SS", "Shanghai Comp"],
      ["^KS11", "KOSPI"],
      ["^TWII", "Taiex"],
      ["^AXJO", "S&P/ASX 200"],
      ["^NSEI", "Nifty 50"],
    ],
  },
] as const;
const allIndices = worldIndices.flatMap((group) =>
  group.items.map(([symbol]) => symbol),
);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

function IndexRow({
  symbol,
  label,
  quote,
  ytd,
  select,
}: {
  symbol: string;
  label: string;
  quote?: Quote;
  ytd?: number | null;
  select: (symbol: string) => void;
}) {
  return (
    <tr>
      <td>
        <button
          type="button"
          className="security-link"
          onClick={() => select(symbol)}
        >
          {label}
        </button>
      </td>
      <td className="num">
        <Tick value={quote?.price} />
      </td>
      <td className={`num ${tone(quote?.change)}`}>{amount(quote?.change)}</td>
      <td className={`num heat-cell ${heat(quote?.percent) ?? ""}`}>
        <Change value={quote?.percent} />
      </td>
      <td className="num">
        <Change value={ytd} />
      </td>
      <td className="num">
        <Freshness
          symbol={symbol}
          quoteMs={quote ? quote.time * 1000 : null}
        />
      </td>
    </tr>
  );
}

function WorldIndices({
  select,
  refresh,
}: {
  select: (symbol: string) => void;
  refresh: boolean;
}) {
  const { data, error, isLoading, mutate } = useQuotes(allIndices, refresh);
  const { data: ytd } = useSWR<{ quotes: Quote[] }>(
    `/api/market?${new URLSearchParams({ symbols: allIndices.join(","), since: yearStart() })}`,
    api,
    { errorRetryCount: 1, revalidateOnFocus: false },
  );
  const quotes = new Map(data?.quotes.map((quote) => [quote.symbol, quote]));
  const year = new Map(
    ytd?.quotes.map((quote) => [quote.symbol, quote.periodPercent]),
  );
  return (
    <div className="term-stack">
      <Failure error={error} retry={() => void mutate()} />
      {isLoading ? (
        <Loading />
      ) : (
        <div className="desk-table-wrap">
          <table className="data-table term-table monitor-table">
            <thead>
              <tr>
                <th>Index</th>
                <th className="num">Value</th>
                <th className="num">Net</th>
                <th className="num">%Chg</th>
                <th className="num">YTD</th>
                <th className="num">Time</th>
              </tr>
            </thead>
            {worldIndices.map((group) => (
              <tbody key={group.region}>
                <tr className="group-row">
                  <th colSpan={6}>{group.region}</th>
                </tr>
                {group.items.map(([symbol, label]) => (
                  <IndexRow
                    key={symbol}
                    symbol={symbol}
                    label={label}
                    quote={quotes.get(symbol)}
                    ytd={year.get(symbol)}
                    select={select}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}

const fiveYearsAgo = () => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 5);
  return date.toISOString().slice(0, 10);
};

function Economics() {
  const [series, setSeries] = useState("DGS10");
  const catalog = useSWR<MacroCatalog>("/api/security?macro=", api, {
    revalidateOnFocus: false,
  });
  const history = useSWR<MacroHistory>(
    `/api/security?${new URLSearchParams({ macro: series, from: fiveYearsAgo() })}`,
    api,
    { revalidateOnFocus: false, errorRetryCount: 1 },
  );
  const observations = history.data?.observations ?? [];
  const latest = observations.at(-1);
  const prior = observations.at(-2);
  const yearAgo = observations.findLast(
    (row) =>
      latest &&
      new Date(row.date) <=
        new Date(new Date(latest.date).setFullYear(new Date(latest.date).getFullYear() - 1)),
  );
  return (
    <div className="eco-layout">
      <div className="eco-list">
        <Failure error={catalog.error} />
        {catalog.data?.series.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === series}
            onClick={() => setSeries(item.id)}
          >
            <span className="security-code">{item.id}</span>
            <span>{item.name}</span>
            <small>{item.frequency}</small>
          </button>
        ))}
        {catalog.isLoading ? <Loading /> : null}
      </div>
      <div className="eco-detail">
        <Failure error={history.error} />
        {history.isLoading ? (
          <Loading />
        ) : history.data ? (
          <>
            <div className="term-figure">
              <strong>{number(latest?.value)}</strong>
              <span>
                {history.data.series.units} · {latest?.date}
                {prior ? (
                  <>
                    {" · prior "}
                    {number(prior.value)}
                  </>
                ) : null}
                {yearAgo ? (
                  <>
                    {" · 1y ago "}
                    {number(yearAgo.value)}
                  </>
                ) : null}
              </span>
            </div>
            <div className="eco-chart">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <LineChart data={observations} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--rule)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(0, 7)}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={{ stroke: "var(--strong-border)" }}
                    tickLine={false}
                    minTickGap={50}
                  />
                  <YAxis
                    orientation="right"
                    width={56}
                    domain={["auto", "auto"]}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--strong-border)",
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="linear"
                    dataKey="value"
                    name={history.data.series.id}
                    stroke="var(--chart-1)"
                    dot={false}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="term-source">
              FRED · {history.data.series.name} ·{" "}
              <a href={history.data.series.url} target="_blank" rel="noreferrer">
                source
              </a>
            </p>
          </>
        ) : null}
        {!history.isLoading && !history.data && !history.error ? (
          <Empty title="Pick a series" />
        ) : null}
      </div>
    </div>
  );
}

export function Monitor({
  fn,
  setFn,
  select,
  refresh,
  symbols,
  correlate,
  overlay,
}: {
  fn: MonitorFunction;
  setFn: (fn: MonitorFunction) => void;
  select: (symbol: string) => void;
  refresh: boolean;
  symbols?: string[];
  correlate: (symbols: string[]) => void;
  overlay: (symbols: string[]) => void;
}) {
  return (
    <section className="panel security-panel">
      <nav className="function-bar" aria-label="Monitors">
        {monitorFunctions.map((item, index) => (
          <button
            key={item.code}
            type="button"
            aria-current={item.code === fn ? "page" : undefined}
            title={item.detail}
            onClick={() => setFn(item.code)}
          >
            <span className="fn-index">{index + 1})</span>
            <span className="fn-code">{item.code}</span>
            <span className="fn-label">{item.label}</span>
          </button>
        ))}
      </nav>
      {fn === "MOST" ? <MostActive select={select} /> : null}
      {fn === "WEI" ? <WorldIndices select={select} refresh={refresh} /> : null}
      {fn === "ECO" ? <Economics /> : null}
      {fn === "GC" ? <YieldCurve /> : null}
      {fn === "FXC" ? <CrossRates select={select} /> : null}
      {fn === "CMDTY" ? (
        <QuoteBoard
          groups={commodityBoard}
          refresh={refresh}
          select={select}
          source="Front-month futures · exchange-delayed · Yahoo Finance"
        />
      ) : null}
      {fn === "CRYP" ? (
        <QuoteBoard
          groups={cryptoBoard}
          refresh={refresh}
          select={select}
          source="Spot prices in USD and US-listed proxies · Yahoo Finance"
        />
      ) : null}
      {fn === "CORR" ? (
        <Correlation
          key={symbols?.join(",") ?? ""}
          select={select}
          initial={symbols}
        />
      ) : null}
      {fn === "RRG" ? <Rotation select={select} /> : null}
      {fn === "EQS" ? (
        <Screener select={select} correlate={correlate} overlay={overlay} />
      ) : null}
    </section>
  );
}
