"use client";

import { type ReactNode, useState } from "react";
import {
  Area,
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import useSWR from "swr";
import { api, Empty, Failure, Loading, SymbolLink } from "@/components/shared";
import type {
  AppsTicker,
  AtsSeries,
  AttentionTicker,
  OffExchangeSeries,
  OffExchangeTop,
  PatentRecord,
  PatentsTicker,
  PolymarketMarkets,
  PolymarketTrades,
  WarnFeed as WarnFeedData,
  WarnNotice,
  WarnTicker,
} from "@/lib/alt/market/types";
import type { AltResult } from "@/lib/alt/types";
import { compact, number } from "@/lib/utils";

const MINUTE = 60_000;

function useAlt<T>(
  dataset: string,
  params: Record<string, string | number> = {},
  refreshMs = 0,
) {
  const query = new URLSearchParams({
    dataset,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
  });
  const { data, error, isLoading, mutate } = useSWR<AltResult<T>>(
    `/api/alt?${query}`,
    api,
    {
      refreshInterval: refreshMs,
      revalidateOnFocus: false,
      errorRetryCount: 1,
      keepPreviousData: true,
    },
  );
  return { data, error, isLoading, retry: () => void mutate() };
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});
const parse = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
const dateLabel = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const date = parse(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
};
const usd = (value: number | null | undefined) =>
  value == null ? "—" : `$${compact(value)}`;
const pct = (value: number | null | undefined, digits = 1) =>
  value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
const fixed = (value: number | null | undefined, digits = 2) =>
  value == null ? "—" : value.toFixed(digits);
const ago = (seconds: number) => {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
};

function Provenance<T>({
  result,
  detail,
}: {
  result: AltResult<T>;
  detail?: ReactNode;
}) {
  return (
    <span className="term-source">
      {result.source}
      {result.asOf ? ` · as of ${dateLabel(result.asOf)}` : ""}
      {` · fetched ${new Date(result.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
      {result.stale ? " · stale, refresh failed" : ""}
      {detail ? <> · {detail}</> : null}
    </span>
  );
}

function Gate<T>({
  state,
  children,
}: {
  state: ReturnType<typeof useAlt<T>>;
  children: (result: AltResult<T>) => ReactNode;
}) {
  if (state.error && !state.data)
    return <Failure error={state.error} retry={state.retry} />;
  if (!state.data) return <Loading message="Loading" />;
  return <>{children(state.data)}</>;
}

function Segment<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };

function Tip({ children }: { children: ReactNode }) {
  return <div className="chart-tip">{children}</div>;
}

function Ticker({
  symbol,
  select,
  label,
}: {
  symbol: string | null;
  select?: (symbol: string) => void;
  label?: string;
}) {
  if (!symbol) return <span className="muted">—</span>;
  return select ? (
    <SymbolLink symbol={symbol} select={select} label={label} />
  ) : (
    symbol
  );
}

export function OffExchangeBoard({
  select,
}: {
  select?: (symbol: string) => void;
}) {
  const [sort, setSort] = useState<"dpi" | "volume">("dpi");
  const state = useAlt<OffExchangeTop>(
    "offexchange.top",
    { sort, limit: 60 },
    30 * MINUTE,
  );
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <Segment
          label="Rank by"
          value={sort}
          onChange={setSort}
          options={[
            ["dpi", "DPI"],
            ["volume", "Off-exchange volume"],
          ]}
        />
      </div>
      <Gate state={state}>
        {(result) => (
          <>
            {result.data.rows.length ? (
              <div className="desk-table-wrap">
                <table className="data-table alt-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th className="num">DPI</th>
                      <th className="num">Short volume</th>
                      <th className="num">Off-exchange volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.rows.map((row) => (
                      <tr key={row.symbol}>
                        <td>
                          <Ticker symbol={row.symbol} select={select} />
                        </td>
                        <td className="num">{pct(row.dpi)}</td>
                        <td className="num">{compact(row.shortVolume)}</td>
                        <td className="num">{compact(row.totalVolume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No symbols above the volume floor" />
            )}
            <Provenance
              result={result}
              detail={`min ${compact(result.data.minVolume)} shares`}
            />
          </>
        )}
      </Gate>
    </div>
  );
}

function OffExchangeChart({ series }: { series: OffExchangeSeries }) {
  return (
    <div style={{ height: 170 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={series.points}
          margin={{ top: 6, right: 0, bottom: 0, left: 0 }}
        >
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => shortDate.format(parse(value))}
            tickLine={false}
            axisLine={{ stroke: "var(--strong-border)" }}
            tick={axisTick}
            minTickGap={24}
          />
          <YAxis yAxisId="volume" hide />
          <YAxis
            yAxisId="dpi"
            orientation="right"
            domain={[0, 1]}
            tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
            width={36}
            tickLine={false}
            axisLine={false}
            tick={axisTick}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: "var(--strong-border)" }}
            content={({ active, payload }) => {
              const item = payload?.[0]?.payload;
              if (!active || !item) return null;
              return (
                <Tip>
                  <span>{dateLabel(item.date)}</span>
                  <strong>DPI {pct(item.dpi)}</strong>
                  <span>{compact(item.totalVolume)} off-exchange</span>
                </Tip>
              );
            }}
          />
          <Bar
            yAxisId="volume"
            dataKey="totalVolume"
            fill="var(--muted)"
            isAnimationActive={false}
          />
          <Line
            yAxisId="dpi"
            dataKey="dpi"
            stroke="var(--foreground)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OffExchangeView({ ticker }: { ticker: string }) {
  const state = useAlt<OffExchangeSeries>("offexchange.ticker", {
    symbol: ticker,
    days: 30,
  });
  const ats = useAlt<AtsSeries>("offexchange.ats", { symbol: ticker });
  return (
    <Gate state={state}>
      {(result) => {
        const { latest, baselineDpi, dpiZScore } = result.data;
        const weeks = ats.data?.data.weeks.slice(-6) ?? [];
        return (
          <div className="term-stack">
            <section className="term-block">
              <h3>Off-exchange volume</h3>
              <dl className="term-fields">
                <Stat label="DPI" value={pct(latest?.dpi)} />
                <Stat label="Baseline DPI" value={pct(baselineDpi)} />
                <Stat label="DPI z-score" value={fixed(dpiZScore)} />
                <Stat
                  label="Off-exchange volume"
                  value={compact(latest?.totalVolume)}
                />
                <Stat
                  label="Short volume"
                  value={compact(latest?.shortVolume)}
                />
              </dl>
              <OffExchangeChart series={result.data} />
            </section>
            {weeks.length ? (
              <div className="desk-table-wrap">
                <table className="data-table alt-table">
                  <thead>
                    <tr>
                      <th>Week of</th>
                      <th className="num">ATS shares</th>
                      <th className="num">ATS notional</th>
                      <th className="num">Other OTC shares</th>
                      <th className="num">Other OTC notional</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.toReversed().map((week) => (
                      <tr key={week.weekStart}>
                        <td>{dateLabel(week.weekStart)}</td>
                        <td className="num">{compact(week.atsShares)}</td>
                        <td className="num">{usd(week.atsNotional)}</td>
                        <td className="num">{compact(week.nonAtsShares)}</td>
                        <td className="num">{usd(week.nonAtsNotional)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <Provenance
              result={result}
              detail={
                ats.data
                  ? `${ats.data.source}, as of ${dateLabel(ats.data.asOf)}`
                  : undefined
              }
            />
          </div>
        );
      }}
    </Gate>
  );
}

const marketTags = [
  ["all", "All"],
  ["economy", "Economy"],
  ["fed", "Fed"],
  ["finance", "Finance"],
  ["stocks", "Stocks"],
  ["earnings", "Earnings"],
  ["ipos", "IPOs"],
  ["politics", "Politics"],
] as const;

export function PolymarketBoard() {
  const [tag, setTag] = useState<(typeof marketTags)[number][0]>("all");
  const [scope, setScope] = useState<PolymarketTrades["scope"]>("finance");
  const trades = useAlt<PolymarketTrades>(
    "polymarket.trades",
    { limit: 25, scope },
    MINUTE,
  );
  const markets = useAlt<PolymarketMarkets>(
    "polymarket.markets",
    { tag },
    MINUTE,
  );
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <Segment
          label="Trades in"
          value={scope}
          onChange={setScope}
          options={[
            ["finance", "Markets and economy"],
            ["all", "Every market"],
          ]}
        />
      </div>
      <Gate state={trades}>
        {(result) => (
          <>
            {result.data.trades.length ? (
              <div className="desk-table-wrap">
                <table className="data-table alt-table">
                  <thead>
                    <tr>
                      <th>Age</th>
                      <th>Market</th>
                      <th>Outcome</th>
                      <th>Side</th>
                      <th className="num">Price</th>
                      <th className="num">Notional</th>
                      <th>Wallet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.trades.map((trade) => (
                      <tr
                        key={`${trade.wallet}-${trade.time}-${trade.notional}`}
                      >
                        <td>{ago(trade.time)}</td>
                        <td>{trade.question}</td>
                        <td>{trade.outcome}</td>
                        <td>{trade.side}</td>
                        <td className="num">{trade.price.toFixed(3)}</td>
                        <td className="num">{usd(trade.notional)}</td>
                        <td className="muted">
                          {trade.pseudonym ?? `${trade.wallet.slice(0, 8)}…`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No large trades" />
            )}
            <Provenance
              result={result}
              detail={`≥ ${usd(result.data.minNotional)}, largest of the latest 100${result.data.scope === "finance" ? " in finance, economy, Fed, stocks, earnings and IPO markets" : " across every market"}`}
            />
          </>
        )}
      </Gate>
      <div className="term-toolbar">
        <Segment
          label="Tag"
          value={tag}
          onChange={setTag}
          options={marketTags}
        />
      </div>
      <Gate state={markets}>
        {(result) => (
          <>
            {result.data.markets.length ? (
              <div className="desk-table-wrap">
                <table className="data-table alt-table">
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th>Probabilities</th>
                      <th className="num">24h volume</th>
                      <th className="num">Liquidity</th>
                      <th>Ends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.markets.slice(0, 40).map((market) => (
                      <tr key={market.id}>
                        <td>
                          {market.question}
                          {market.event && market.event !== market.question ? (
                            <span className="muted"> · {market.event}</span>
                          ) : null}
                        </td>
                        <td>
                          {market.outcomes
                            .slice(0, 3)
                            .map((o) => `${o.label} ${pct(o.probability, 0)}`)
                            .join(" · ")}
                        </td>
                        <td className="num">{usd(market.volume24h)}</td>
                        <td className="num">{usd(market.liquidity)}</td>
                        <td>{dateLabel(market.endDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No active markets" />
            )}
            <Provenance result={result} />
          </>
        )}
      </Gate>
    </div>
  );
}

function PatentTable({ rows, label }: { rows: PatentRecord[]; label: string }) {
  if (!rows.length) return <Empty title={`No ${label}`} />;
  return (
    <div className="desk-table-wrap">
      <table className="data-table alt-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Number</th>
            <th>Title</th>
            <th>CPC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.kind}-${row.applicationNumber}`}>
              <td>{dateLabel(row.date)}</td>
              <td>{row.number ?? "—"}</td>
              <td>{row.title}</td>
              <td className="muted">
                {[...new Set(row.cpc.map((c) => c.slice(0, 4)))]
                  .slice(0, 4)
                  .join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PatentsView({ ticker }: { ticker: string }) {
  const state = useAlt<PatentsTicker>("patents.ticker", { symbol: ticker });
  return (
    <Gate state={state}>
      {(result) => {
        const { metrics } = result.data;
        return (
          <div className="term-stack">
            <section className="term-block">
              <h3>Patent activity</h3>
              <dl className="term-fields">
                <Stat
                  label="Grants, 90 days"
                  value={number(metrics.trailing90)}
                />
                <Stat
                  label="Momentum z-score"
                  value={fixed(metrics.momentumZ)}
                />
                <Stat label="CPC drift" value={fixed(metrics.driftCosine, 3)} />
                <Stat
                  label="Drift sample"
                  value={`${metrics.driftSample.recent} / ${metrics.driftSample.prior}`}
                />
              </dl>
            </section>
            <PatentTable
              rows={result.data.grants}
              label="grants in the last year"
            />
            <PatentTable
              rows={result.data.applications}
              label="published applications in the last year"
            />
            <Provenance
              result={result}
              detail={`applicant: ${result.data.names.join(" · ")}`}
            />
          </div>
        );
      }}
    </Gate>
  );
}

const ratingStars = (value: number | null) =>
  value == null ? "—" : value.toFixed(2);

export function AppRatingsView({ ticker }: { ticker: string }) {
  const state = useAlt<AppsTicker>("apps.ticker", { symbol: ticker });
  return (
    <Gate state={state}>
      {(result) => {
        const { apps, history } = result.data;
        if (!apps.length)
          return (
            <>
              <Empty title="No App Store apps found for this company" />
              <Provenance result={result} />
            </>
          );
        const first = history[0];
        return (
          <div className="term-stack">
            <div className="desk-table-wrap">
              <table className="data-table alt-table">
                <thead>
                  <tr>
                    <th>App</th>
                    <th className="num">Rating</th>
                    <th className="num">
                      Δ since {first ? dateLabel(first.date) : "first record"}
                    </th>
                    <th className="num">Ratings</th>
                    <th className="num">Δ ratings</th>
                    <th>Version</th>
                    <th>Released</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app) => {
                    const base = first?.apps.find(
                      (a) => a.trackId === app.trackId,
                    );
                    const ratingDelta =
                      base?.rating != null && app.rating != null
                        ? app.rating - base.rating
                        : null;
                    const countDelta = base
                      ? app.ratingCount - base.ratingCount
                      : null;
                    return (
                      <tr key={app.trackId}>
                        <td>
                          {app.url ? (
                            <a href={app.url} target="_blank" rel="noreferrer">
                              {app.name}
                            </a>
                          ) : (
                            app.name
                          )}
                        </td>
                        <td className="num">{ratingStars(app.rating)}</td>
                        <td className="num">
                          {ratingDelta == null
                            ? "—"
                            : `${ratingDelta > 0 ? "+" : ""}${ratingDelta.toFixed(2)}`}
                        </td>
                        <td className="num">{compact(app.ratingCount)}</td>
                        <td className="num">
                          {countDelta == null
                            ? "—"
                            : `${countDelta > 0 ? "+" : ""}${compact(countDelta)}`}
                        </td>
                        <td>{app.version ?? "—"}</td>
                        <td>{dateLabel(app.releaseDate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Provenance
              result={result}
              detail={`${history.length} daily snapshot${history.length === 1 ? "" : "s"} recorded`}
            />
          </div>
        );
      }}
    </Gate>
  );
}

export function AttentionView({ ticker }: { ticker: string }) {
  const state = useAlt<AttentionTicker>("wiki.ticker", {
    symbol: ticker,
    days: 90,
  });
  return (
    <Gate state={state}>
      {(result) => {
        const { article, latest, mean30, zScore30, points } = result.data;
        return (
          <div className="term-stack">
            <section className="term-block">
              <h3>{article}</h3>
              <dl className="term-fields">
                <Stat label="Latest views" value={number(latest?.views)} />
                <Stat
                  label="30-day average"
                  value={number(mean30 && Math.round(mean30))}
                />
                <Stat label="30-day z-score" value={fixed(zScore30)} />
              </dl>
              <div style={{ height: 150 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={points}
                    margin={{ top: 6, right: 0, bottom: 0, left: 0 }}
                  >
                    <XAxis
                      dataKey="date"
                      tickFormatter={(value: string) =>
                        shortDate.format(parse(value))
                      }
                      tickLine={false}
                      axisLine={{ stroke: "var(--strong-border)" }}
                      tick={axisTick}
                      minTickGap={32}
                    />
                    <YAxis
                      orientation="right"
                      width={40}
                      tickFormatter={(value: number) => compact(value)}
                      tickLine={false}
                      axisLine={false}
                      tick={axisTick}
                    />
                    <Tooltip
                      isAnimationActive={false}
                      cursor={{ stroke: "var(--strong-border)" }}
                      content={({ active, payload }) => {
                        const item = payload?.[0]?.payload;
                        if (!active || !item) return null;
                        return (
                          <Tip>
                            <span>{dateLabel(item.date)}</span>
                            <strong>{number(item.views)} views</strong>
                          </Tip>
                        );
                      }}
                    />
                    <Area
                      dataKey="views"
                      type="monotone"
                      stroke="var(--foreground)"
                      strokeWidth={1.5}
                      fill="var(--muted)"
                      fillOpacity={0.6}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>
            <Provenance result={result} />
          </div>
        );
      }}
    </Gate>
  );
}

function WarnTable({
  rows,
  select,
}: {
  rows: WarnNotice[];
  select?: (symbol: string) => void;
}) {
  if (!rows.length) return <Empty title="No notices" />;
  return (
    <div className="desk-table-wrap">
      <table className="data-table alt-table">
        <thead>
          <tr>
            <th>Notice</th>
            <th>State</th>
            {select ? <th>Ticker</th> : null}
            <th>Company</th>
            <th>Location</th>
            <th>Effective</th>
            <th className="num">Employees</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.state}-${row.company}-${row.noticeDate}-${index}`}>
              <td>{dateLabel(row.noticeDate)}</td>
              <td>{row.state}</td>
              {select ? (
                <td>
                  <Ticker
                    symbol={row.ticker}
                    select={select}
                    label={row.company}
                  />
                </td>
              ) : null}
              <td>{row.company}</td>
              <td className="muted">{row.location ?? "—"}</td>
              <td>{dateLabel(row.effectiveDate)}</td>
              <td className="num">{number(row.employees)}</td>
              <td className="muted">{row.type ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const warnStates = [
  ["", "All"],
  ["CA", "CA"],
  ["IL", "IL"],
  ["NJ", "NJ"],
  ["TX", "TX"],
  ["WA", "WA"],
] as const;

export function WarnFeed({ select }: { select?: (symbol: string) => void }) {
  const [stateCode, setStateCode] =
    useState<(typeof warnStates)[number][0]>("");
  const [days, setDays] = useState<"30" | "90">("30");
  const state = useAlt<WarnFeedData>(
    "warn.recent",
    { days, ...(stateCode ? { state: stateCode } : {}) },
    30 * MINUTE,
  );
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <Segment
          label="State"
          value={stateCode}
          onChange={setStateCode}
          options={warnStates}
        />
        <Segment
          label="Window"
          value={days}
          onChange={setDays}
          options={[
            ["30", "30d"],
            ["90", "90d"],
          ]}
        />
      </div>
      <Gate state={state}>
        {(result) => {
          const failed = result.data.states.filter((s) => !s.ok);
          return (
            <>
              <WarnTable rows={result.data.notices} select={select} />
              <Provenance
                result={result}
                detail={
                  failed.length
                    ? `unavailable: ${failed.map((s) => s.state).join(", ")}`
                    : undefined
                }
              />
            </>
          );
        }}
      </Gate>
    </div>
  );
}

export function WarnView({ ticker }: { ticker: string }) {
  const state = useAlt<WarnTicker>("warn.ticker", { symbol: ticker });
  return (
    <Gate state={state}>
      {(result) => (
        <div className="term-stack">
          <WarnTable rows={result.data.notices} />
          <Provenance result={result} />
        </div>
      )}
    </Gate>
  );
}
