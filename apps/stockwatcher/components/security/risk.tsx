"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Empty, Failure, Loading } from "@/components/shared";
import { useQuotes } from "@/components/market-widgets";
import type { Workspace } from "@/lib/models";
import { positionsFor } from "@/lib/portfolio";
import { portfolioRisk } from "@/lib/analytics";
import { downloadCsv } from "@/lib/export";
import { compact, number, percent, tone } from "@/lib/utils";
import { useHistory } from "./quant";

const subunits: Record<string, [string, number]> = {
  GBp: ["GBP", 100],
  ZAc: ["ZAR", 100],
  ILA: ["ILS", 100],
};
const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };
const day = (time: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(time * 1000);
const pct = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(2)}%`);
const shocks = [-20, -10, -5, 5, 10];

export function PortfolioRiskView({
  books,
  trades,
  select,
}: {
  books: Workspace["books"];
  trades: Workspace["trades"];
  select: (symbol: string) => void;
}) {
  const [book, setBook] = useState("all");
  const [benchmark, setBenchmark] = useState("SPY");
  const [years, setYears] = useState(1);
  const holdings = useMemo(() => {
    const chosen = book === "all" ? books : books.filter((item) => item.id === book);
    const merged = new Map<string, { symbol: string; currency: string; quantity: number }>();
    for (const item of chosen)
      for (const position of positionsFor(trades.filter((trade) => trade.bookId === item.id))) {
        if (position.quantity <= 0) continue;
        const key = `${position.symbol}:${position.currency}`;
        const prior = merged.get(key);
        merged.set(key, { ...position, quantity: (prior?.quantity ?? 0) + position.quantity });
      }
    return [...merged.values()];
  }, [book, books, trades]);
  const currencies = [
    ...new Set(holdings.map((item) => subunits[item.currency]?.[0] ?? item.currency)),
  ].filter((code) => code !== "USD");
  const symbols = holdings.map((item) => item.symbol);
  const quotes = useQuotes([...symbols, ...currencies.map((code) => `${code}USD=X`)], false);
  const history = useHistory(symbols.length ? [...new Set([...symbols, benchmark])] : [], years);
  const byQuote = new Map(quotes.data?.quotes.map((quote) => [quote.symbol, quote]));

  const valued = holdings.map((item) => {
    const quote = byQuote.get(item.symbol);
    const [base, divisor] = subunits[item.currency] ?? [item.currency, 1];
    const fx = base === "USD" ? 1 : byQuote.get(`${base}USD=X`)?.price;
    const price = quote && quote.currency === item.currency ? quote.price : null;
    const usd = price != null && fx != null ? (item.quantity * price * fx) / divisor : null;
    return { ...item, price, usd };
  });
  const totalUsd = valued.reduce((sum, item) => sum + (item.usd ?? 0), 0);
  const unpriced = valued.filter((item) => item.usd == null).map((item) => item.symbol);

  const risk = useMemo(() => {
    if (!history.data || !totalUsd) return null;
    const find = (symbol: string) =>
      history.data?.series.find((item) => item.symbol === symbol)?.points ?? [];
    return portfolioRisk(
      valued.flatMap((item) =>
        item.usd == null ? [] : [{ symbol: item.symbol, weight: item.usd / totalUsd, points: find(item.symbol) }],
      ),
      find(benchmark),
    );
  }, [history.data, valued, totalUsd, benchmark]);

  if (!books.length || !trades.length)
    return <Empty title="No positions">Record trades in PORT to see portfolio risk.</Empty>;
  const money = (fraction: number) => `$${compact(Math.abs(fraction) * totalUsd)}`;
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="row-actions">
          <label className="graph-select">
            Book
            <select className="studio-select" value={book} onChange={(event) => setBook(event.target.value)}>
              <option value="all">All books</option>
              {books.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="graph-select">
            vs
            <select className="studio-select" value={benchmark} onChange={(event) => setBenchmark(event.target.value)}>
              {["SPY", "QQQ", "ACWI", "EFA", "^STOXX50E", "^GSPC"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <div className="seg" role="group" aria-label="History">
            {[1, 2, 3, 5].map((value) => (
              <button key={value} type="button" aria-pressed={years === value} onClick={() => setYears(value)}>
                {value}Y
              </button>
            ))}
          </div>
        </div>
        {risk ? (
          <button
            type="button"
            className="chip"
            onClick={() => downloadCsv(risk.contributions.map((row) => ({ ...row })), "portfolio-risk")}
          >
            Export CSV
          </button>
        ) : null}
      </div>
      <Failure error={quotes.error ?? history.error} retry={() => void history.mutate()} />
      {history.isLoading || quotes.isLoading ? (
        <Loading message="Loading positions and history" />
      ) : !risk ? (
        <Empty title="Not enough priced history">Positions need a quote in their trade currency and a year of history.</Empty>
      ) : (
        <>
          <dl className="quant-stats">
            <div>
              <dt>Gross value</dt>
              <dd>${compact(totalUsd)}</dd>
            </div>
            <div title="Annualised standard deviation of daily returns at today's weights">
              <dt>Volatility</dt>
              <dd>{pct(risk.volatility)}</dd>
            </div>
            <div>
              <dt>Beta vs {benchmark}</dt>
              <dd>{risk.beta == null ? "—" : risk.beta.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Correlation</dt>
              <dd>{number(risk.correlation)}</dd>
            </div>
            <div title="One-day loss not exceeded on 95% of historical days">
              <dt>1D VaR 95%</dt>
              <dd className="negative">
                {pct(risk.var95)} · {money(risk.var95 / 100)}
              </dd>
            </div>
            <div>
              <dt>1D VaR 99%</dt>
              <dd className="negative">
                {pct(risk.var99)} · {money(risk.var99 / 100)}
              </dd>
            </div>
            <div title="Average loss on the worst 5% of days">
              <dt>Expected shortfall</dt>
              <dd className="negative">
                {pct(risk.es95)} · {money(risk.es95 / 100)}
              </dd>
            </div>
            <div>
              <dt>Max drawdown</dt>
              <dd className="negative">{pct(risk.maxDrawdown)}</dd>
            </div>
          </dl>
          <div className="quant-split">
            <div className="term-stack">
              <h3 className="risk-heading">Risk contribution</h3>
              <table className="data-table term-table">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th className="num">Weight</th>
                    <th className="num">Vol</th>
                    <th className="num">Beta</th>
                    <th className="num">Risk share</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...risk.contributions]
                    .sort((a, b) => b.contribution - a.contribution)
                    .map((row) => (
                      <tr key={row.symbol}>
                        <td>
                          <button type="button" className="security-link" onClick={() => select(row.symbol)}>
                            {row.symbol}
                          </button>
                        </td>
                        <td className="num">{pct(row.weight)}</td>
                        <td className="num">{pct(row.volatility)}</td>
                        <td className="num">{row.beta == null ? "—" : row.beta.toFixed(2)}</td>
                        <td className="num">{pct(row.contribution)}</td>
                        <td className="risk-bar-cell">
                          <span className="risk-bar" style={{ width: `${Math.min(100, Math.max(0, row.contribution))}%` }} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <h3 className="risk-heading">Beta stress</h3>
              <table className="data-table term-table">
                <thead>
                  <tr>
                    <th>{benchmark} move</th>
                    {shocks.map((shock) => (
                      <th key={shock} className="num">
                        {shock > 0 ? "+" : ""}
                        {shock}%
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>Portfolio</th>
                    {shocks.map((shock) => {
                      const move = (risk.beta ?? 0) * shock;
                      return (
                        <td key={shock} className={`num ${tone(move)}`}>
                          {percent(move)}
                          <small className="risk-money">
                            {move < 0 ? "−" : "+"}
                            {money(move / 100)}
                          </small>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="term-stack">
              <h3 className="risk-heading">At today&apos;s weights, cumulative</h3>
              <div className="quant-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={risk.curve} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--rule)" />
                    <XAxis dataKey="time" tickFormatter={(v: number) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" }).format(v * 1000)} tick={axisTick} minTickGap={50} axisLine={false} tickLine={false} />
                    <YAxis orientation="right" width={48} tick={axisTick} tickFormatter={(v: number) => `${v.toFixed(0)}%`} axisLine={false} tickLine={false} />
                    <Tooltip
                      isAnimationActive={false}
                      labelFormatter={(v) => (typeof v === "number" ? day(v) : String(v))}
                      formatter={(value) => (typeof value === "number" ? percent(value) : value)}
                      contentStyle={{ background: "var(--card)", border: "1px solid var(--strong-border)", fontSize: 12 }}
                    />
                    <Line dataKey="portfolio" name="Portfolio" stroke="var(--term-header)" dot={false} strokeWidth={1.8} isAnimationActive={false} />
                    <Line dataKey="benchmark" name={benchmark} stroke="var(--muted-foreground)" strokeDasharray="4 3" dot={false} strokeWidth={1.1} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <h3 className="risk-heading">Worst {benchmark} days</h3>
              <table className="data-table term-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">{benchmark}</th>
                    <th className="num">Portfolio</th>
                  </tr>
                </thead>
                <tbody>
                  {risk.worstDays.map((row) => (
                    <tr key={row.time}>
                      <td>{day(row.time)}</td>
                      <td className={`num ${tone(row.benchmark)}`}>{percent(row.benchmark)}</td>
                      <td className={`num ${tone(row.portfolio)}`}>{percent(row.portfolio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <p className="term-source">
        Historical simulation over {risk?.observations ?? 0} common trading days: today&apos;s positions applied to past daily returns, valued in
        USD at today&apos;s FX rates. Risk share is each position&apos;s contribution to portfolio variance.
        {unpriced.length ? ` Not priced: ${unpriced.join(", ")}.` : ""}
      </p>
    </div>
  );
}
