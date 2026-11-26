"use client";

import { type ReactNode, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import useSWR from "swr";
import { api, Empty, Failure, Loading } from "@/components/shared";
import {
  backtest,
  drawdowns,
  parkinson,
  regression,
  rollingBeta,
  rollingVolatility,
  type Strategy,
  seasonality,
  strategyKinds,
  strategyLabels,
} from "@/lib/analytics";
import { downloadCsv } from "@/lib/export";
import type { History } from "@/lib/market";
import { amount, number, percent, tone } from "@/lib/utils";

export type HistoryResponse = { series: History[]; missing: string[] };

export function useHistory(
  symbols: string[],
  years: number,
  interval: "1d" | "1wk" | "1mo" = "1d",
) {
  const key = symbols.length
    ? `/api/history?${new URLSearchParams({ symbols: symbols.join(","), years: String(years), interval })}`
    : null;
  return useSWR<HistoryResponse>(key, api, {
    revalidateOnFocus: false,
    errorRetryCount: 1,
    keepPreviousData: true,
  });
}

const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };
const dateTick = (years: number) => (value: number) =>
  new Intl.DateTimeFormat(
    "en-GB",
    years > 2
      ? { month: "short", year: "2-digit" }
      : { day: "numeric", month: "short" },
  ).format(value * 1000);
const fullDate = (value: number) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value * 1000);
const pct = (value: number | null | undefined, digits = 1) =>
  value == null ? "—" : `${value.toFixed(digits)}%`;
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const yearOptions = [1, 2, 3, 5, 10, 20];

function YearPicker({
  value,
  onChange,
  options = yearOptions,
}: {
  value: number;
  onChange: (years: number) => void;
  options?: number[];
}) {
  return (
    <div className="seg" role="group" aria-label="Look-back">
      {options.map((years) => (
        <button
          key={years}
          type="button"
          aria-pressed={value === years}
          onClick={() => onChange(years)}
        >
          {years}Y
        </button>
      ))}
    </div>
  );
}

function ChartTip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: number | string;
  format: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="quant-tip">
      {typeof label === "number" ? <b>{fullDate(label)}</b> : null}
      {payload.map((item) =>
        typeof item.value === "number" ? (
          <span key={item.name} style={{ color: item.color }}>
            {item.name} {format(item.value)}
          </span>
        ) : null,
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/* HVT · historical volatility */
const windows = [10, 30, 60, 90] as const;
export function Volatility({ ticker }: { ticker: string }) {
  const [years, setYears] = useState(3);
  const { data, error, isLoading, mutate } = useHistory([ticker], years);
  const points = useMemo(() => data?.series[0]?.points ?? [], [data]);
  const rows = useMemo(() => {
    const sets = windows.map((window) => rollingVolatility(points, window));
    const hl = parkinson(points, 30);
    return points.map((point, i) => ({
      time: point.time,
      v10: sets[0][i].value,
      v30: sets[1][i].value,
      v60: sets[2][i].value,
      v90: sets[3][i].value,
      park: hl[i].value,
    }));
  }, [points]);
  const last = rows.at(-1);
  const series30 = rows.flatMap((row) => (row.v30 == null ? [] : [row.v30]));
  const sorted = [...series30].sort((a, b) => a - b);
  const rank =
    last?.v30 != null && sorted.length
      ? (sorted.filter((value) => value <= last.v30!).length / sorted.length) *
        100
      : null;
  const colors = [
    "var(--chart-5)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
  ];
  if (error) return <Failure error={error} retry={() => void mutate()} />;
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <YearPicker
          value={years}
          onChange={setYears}
          options={[1, 2, 3, 5, 10]}
        />
        <button
          type="button"
          className="chip"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              rows.map((row) => ({ date: fullDate(row.time), ...row })),
              `${ticker}-HVT`,
            )
          }
        >
          Export CSV
        </button>
      </div>
      {isLoading && !data ? (
        <Loading message="Loading daily history" />
      ) : !rows.length ? (
        <Empty title="No history" />
      ) : (
        <>
          <dl className="quant-stats">
            {windows.map((window) => (
              <Stat
                key={window}
                label={`${window}D realised`}
                value={pct(last?.[`v${window}`])}
                hint={`Annualised close-to-close volatility over ${window} trading days`}
              />
            ))}
            <Stat
              label="30D Parkinson"
              value={pct(last?.park)}
              hint="High/low range estimator, annualised"
            />
            <Stat
              label="30D percentile"
              value={pct(rank, 0)}
              hint={`Today's 30-day volatility versus the last ${years} years`}
            />
            <Stat
              label={`${years}Y range`}
              value={`${pct(sorted[0], 0)} – ${pct(sorted.at(-1), 0)}`}
            />
          </dl>
          <div className="quant-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis
                  dataKey="time"
                  tickFormatter={dateTick(years)}
                  tick={axisTick}
                  minTickGap={50}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  orientation="right"
                  width={52}
                  tick={axisTick}
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={<ChartTip format={(v) => pct(v)} />}
                  isAnimationActive={false}
                />
                {windows.map((window, i) => (
                  <Line
                    key={window}
                    dataKey={`v${window}`}
                    name={`${window}D`}
                    stroke={colors[i]}
                    strokeWidth={window === 30 ? 1.8 : 1.1}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  dataKey="park"
                  name="Parkinson 30D"
                  stroke="var(--muted-foreground)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <ul className="quant-legend">
            {windows.map((window, i) => (
              <li key={window} style={{ color: colors[i] }}>
                {window}D
              </li>
            ))}
            <li>Parkinson 30D (dashed)</li>
          </ul>
        </>
      )}
      <p className="term-source">
        Realised volatility from dividend- and split-adjusted daily closes,
        annualised with √252. Yahoo Finance history.
      </p>
    </div>
  );
}

/* BETA · regression against a benchmark */
const benchmarks = ["^GSPC", "^NDX", "^STOXX50E", "^FTSE", "SPY", "QQQ", "IWM"];
export function BetaView({ ticker }: { ticker: string }) {
  const [benchmark, setBenchmark] = useState(
    ticker.includes(".") ? "^STOXX50E" : "^GSPC",
  );
  const [years, setYears] = useState(2);
  const [step, setStep] = useState(1);
  const [custom, setCustom] = useState("");
  const { data, error, isLoading, mutate } = useHistory(
    [ticker, benchmark],
    years,
  );
  const security = useMemo(
    () => data?.series.find((item) => item.symbol === ticker)?.points ?? [],
    [data, ticker],
  );
  const bench = useMemo(
    () => data?.series.find((item) => item.symbol === benchmark)?.points ?? [],
    [data, benchmark],
  );
  const fit = useMemo(
    () => regression(security, bench, step),
    [security, bench, step],
  );
  const rolling = useMemo(
    () => rollingBeta(security, bench, 60).filter((row) => row.beta != null),
    [security, bench],
  );
  const line = fit
    ? (() => {
        const xs = fit.points.map((point) => point.x);
        const lo = Math.min(...xs);
        const hi = Math.max(...xs);
        return [
          { x: lo, y: fit.alpha / (252 / step) + fit.beta * lo },
          { x: hi, y: fit.alpha / (252 / step) + fit.beta * hi },
        ];
      })()
    : [];
  if (error) return <Failure error={error} retry={() => void mutate()} />;
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="row-actions">
          <label className="graph-select">
            vs
            <select
              className="studio-select"
              value={benchmarks.includes(benchmark) ? benchmark : "custom"}
              onChange={(event) =>
                event.target.value !== "custom" &&
                setBenchmark(event.target.value)
              }
            >
              {benchmarks.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
              {!benchmarks.includes(benchmark) ? (
                <option value="custom">{benchmark}</option>
              ) : null}
            </select>
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (custom.trim()) setBenchmark(custom.trim().toUpperCase());
              setCustom("");
            }}
          >
            <input
              className="studio-select"
              placeholder="Other index"
              value={custom}
              maxLength={20}
              onChange={(event) => setCustom(event.target.value.toUpperCase())}
              aria-label="Custom benchmark"
            />
          </form>
          <div className="seg" role="group" aria-label="Return interval">
            {[
              [1, "Daily"],
              [5, "Weekly"],
              [21, "Monthly"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={step === value}
                onClick={() => setStep(Number(value))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <YearPicker
          value={years}
          onChange={setYears}
          options={[1, 2, 3, 5, 10]}
        />
      </div>
      {isLoading && !data ? (
        <Loading message="Loading history" />
      ) : !fit ? (
        <Empty title="Not enough overlapping history" />
      ) : (
        <>
          <dl className="quant-stats">
            <Stat label="Raw beta" value={number(fit.beta)} />
            <Stat
              label="Adjusted beta"
              value={number(0.67 * fit.beta + 0.33)}
              hint="Blume adjustment: 0.67 × raw + 0.33, as on BETA <GO>"
            />
            <Stat
              label="Alpha (ann.)"
              value={
                <span className={tone(fit.alpha)}>{percent(fit.alpha)}</span>
              }
            />
            <Stat label="R²" value={number(fit.r2)} />
            <Stat label="Correlation" value={number(fit.correlation)} />
            <Stat label="Std error" value={number(fit.standardError)} />
            <Stat label="Observations" value={fit.observations} />
          </dl>
          <div className="quant-split">
            <div className="quant-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke="var(--rule)" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={benchmark}
                    tick={axisTick}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    domain={["auto", "auto"]}
                    label={{
                      value: `${benchmark} return`,
                      position: "insideBottom",
                      offset: -4,
                      fill: "var(--muted-foreground)",
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name={ticker}
                    tick={axisTick}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    width={44}
                    domain={["auto", "auto"]}
                  />
                  <ZAxis range={[10, 10]} />
                  <ReferenceLine x={0} stroke="var(--strong-border)" />
                  <ReferenceLine y={0} stroke="var(--strong-border)" />
                  <Tooltip
                    isAnimationActive={false}
                    content={({ active, payload }) => {
                      const point = payload?.[0]?.payload as
                        | { x: number; y: number; time?: number }
                        | undefined;
                      if (!active || !point?.time) return null;
                      return (
                        <div className="quant-tip">
                          <b>{fullDate(point.time)}</b>
                          <span>
                            {benchmark} {percent(point.x)}
                          </span>
                          <span>
                            {ticker} {percent(point.y)}
                          </span>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    data={fit.points}
                    fill="var(--chart-3)"
                    fillOpacity={0.45}
                    isAnimationActive={false}
                  />
                  <Scatter
                    data={line}
                    line={{ stroke: "var(--term-header)", strokeWidth: 2 }}
                    shape={() => <g />}
                    isAnimationActive={false}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="quant-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={rolling}
                  margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--rule)" />
                  <XAxis
                    dataKey="time"
                    tickFormatter={dateTick(years)}
                    tick={axisTick}
                    minTickGap={50}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    orientation="right"
                    width={44}
                    tick={axisTick}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ReferenceLine
                    y={1}
                    stroke="var(--strong-border)"
                    strokeDasharray="3 3"
                  />
                  <Tooltip
                    content={<ChartTip format={(v) => number(v)} />}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="beta"
                    name="60D beta"
                    stroke="var(--term-header)"
                    dot={false}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="correlation"
                    name="60D correlation"
                    stroke="var(--chart-3)"
                    dot={false}
                    strokeWidth={1}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <ul className="quant-legend">
            <li style={{ color: "var(--chart-3)" }}>
              Each dot: one period&apos;s returns
            </li>
            <li style={{ color: "var(--term-header)" }}>
              Fitted line · rolling 60-day beta
            </li>
            <li style={{ color: "var(--chart-3)" }}>
              Rolling 60-day correlation
            </li>
          </ul>
        </>
      )}
      <p className="term-source">
        Ordinary least squares on adjusted close-to-close returns. Yahoo Finance
        history.
      </p>
    </div>
  );
}

/* SEAS · seasonality */
const heatClass = (value: number | null) => {
  if (value == null) return "";
  if (value >= 5) return "heat-gain-strong";
  if (value >= 2) return "heat-gain";
  if (value > 0) return "heat-gain-soft";
  if (value <= -5) return "heat-loss-strong";
  if (value <= -2) return "heat-loss";
  if (value < 0) return "heat-loss-soft";
  return "";
};

export function SeasonalityView({ ticker }: { ticker: string }) {
  const [years, setYears] = useState(10);
  const { data, error, isLoading, mutate } = useHistory([ticker], years, "1d");
  const table = useMemo(
    () => seasonality(data?.series[0]?.points ?? []),
    [data],
  );
  const current = new Date().getUTCMonth();
  if (error) return <Failure error={error} retry={() => void mutate()} />;
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <YearPicker
          value={years}
          onChange={setYears}
          options={[5, 10, 15, 20, 30]}
        />
        <span className="term-source">
          Month-end to month-end total returns. The current month is
          month-to-date.
        </span>
      </div>
      {isLoading && !data ? (
        <Loading message="Loading history" />
      ) : !table.years.length ? (
        <Empty title="No history" />
      ) : (
        <div className="desk-table-wrap">
          <table className="data-table term-table seas-table">
            <thead>
              <tr>
                <th>Year</th>
                {months.map((month, i) => (
                  <th
                    key={month}
                    className="num"
                    data-now={i === current || undefined}
                  >
                    {month}
                  </th>
                ))}
                <th className="num">Year</th>
              </tr>
            </thead>
            <tbody>
              {table.years.map((row) => (
                <tr key={row.year}>
                  <th>{row.year}</th>
                  {row.months.map((value, i) => (
                    <td key={i} className={`num heat-cell ${heatClass(value)}`}>
                      {value == null ? "" : value.toFixed(1)}
                    </td>
                  ))}
                  <td className={`num ${tone(row.total)}`}>
                    {row.total == null ? "" : row.total.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {(
                [
                  ["Average", table.average, (v: number) => v.toFixed(2)],
                  ["Median", table.median, (v: number) => v.toFixed(2)],
                  ["% positive", table.hitRate, (v: number) => v.toFixed(0)],
                ] as const
              ).map(([label, values, format]) => (
                <tr key={label}>
                  <th>{label}</th>
                  {values.map((value, i) => (
                    <td
                      key={i}
                      className={`num ${label === "% positive" ? "" : `heat-cell ${heatClass(value)}`}`}
                    >
                      {value == null ? "" : format(value)}
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* BTST · strategy backtester */
const defaults: Record<Strategy["kind"], Partial<Strategy>> = {
  smaCross: { fast: 50, slow: 200 },
  rsi: { fast: 14, lower: 30, upper: 70 },
  breakout: { fast: 55, slow: 20 },
  momentum: { slow: 252 },
  hold: {},
};

export function Backtest({ ticker }: { ticker: string }) {
  const [years, setYears] = useState(10);
  const [strategy, setStrategy] = useState<Strategy>({
    kind: "smaCross",
    fast: 50,
    slow: 200,
    lower: 30,
    upper: 70,
    shorts: false,
    costBps: 5,
  });
  const { data, error, isLoading, mutate } = useHistory([ticker], years);
  const bars = useMemo(() => data?.series[0]?.points ?? [], [data]);
  const result = useMemo(
    () => (bars.length > 30 ? backtest(bars, strategy) : null),
    [bars, strategy],
  );
  const hold = useMemo(() => drawdowns(bars.map((bar) => bar.close)), [bars]);
  const rows = useMemo(
    () =>
      result?.equity.map((row, i) => ({ ...row, holdDrawdown: hold[i] })) ?? [],
    [result, hold],
  );
  const field = (
    key: "fast" | "slow" | "lower" | "upper" | "costBps",
    label: string,
    min: number,
    max: number,
  ) => (
    <label className="graph-select">
      {label}
      <input
        className="studio-select quant-number"
        type="number"
        min={min}
        max={max}
        value={strategy[key]}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value) && value >= min && value <= max)
            setStrategy({ ...strategy, [key]: value });
        }}
      />
    </label>
  );
  if (error) return <Failure error={error} retry={() => void mutate()} />;
  const stats = result?.stats;
  return (
    <div className="term-stack">
      <div className="term-toolbar">
        <div className="row-actions quant-params">
          <select
            className="studio-select"
            value={strategy.kind}
            aria-label="Strategy"
            onChange={(event) => {
              const kind =
                strategyKinds.find((item) => item === event.target.value) ??
                "hold";
              setStrategy({ ...strategy, ...defaults[kind], kind });
            }}
          >
            {strategyKinds.map((kind) => (
              <option key={kind} value={kind}>
                {strategyLabels[kind]}
              </option>
            ))}
          </select>
          {strategy.kind === "smaCross" ? (
            <>
              {field("fast", "Fast", 2, 400)}
              {field("slow", "Slow", 3, 500)}
            </>
          ) : null}
          {strategy.kind === "rsi" ? (
            <>
              {field("fast", "RSI", 2, 100)}
              {field("lower", "Buy <", 1, 50)}
              {field("upper", "Sell >", 50, 99)}
            </>
          ) : null}
          {strategy.kind === "breakout" ? (
            <>
              {field("fast", "Entry", 5, 300)}
              {field("slow", "Exit", 2, 300)}
            </>
          ) : null}
          {strategy.kind === "momentum"
            ? field("slow", "Look-back", 5, 500)
            : null}
          {strategy.kind !== "hold" ? (
            <button
              type="button"
              className="chip"
              aria-pressed={strategy.shorts}
              onClick={() =>
                setStrategy({ ...strategy, shorts: !strategy.shorts })
              }
            >
              Allow shorts
            </button>
          ) : null}
          {field("costBps", "Cost bps", 0, 200)}
        </div>
        <YearPicker
          value={years}
          onChange={setYears}
          options={[3, 5, 10, 20]}
        />
      </div>
      {isLoading && !data ? (
        <Loading message="Loading history" />
      ) : !result || !stats ? (
        <Empty title="Not enough history" />
      ) : (
        <>
          <dl className="quant-stats">
            <Stat
              label="Total return"
              value={
                <span className={tone(stats.totalReturn)}>
                  {percent(stats.totalReturn)}
                </span>
              }
            />
            <Stat
              label="Buy & hold"
              value={
                <span className={tone(rows.at(-1)?.hold)}>
                  {percent(rows.at(-1)?.hold)}
                </span>
              }
            />
            <Stat label="CAGR" value={percent(stats.cagr)} />
            <Stat label="Volatility" value={pct(stats.volatility)} />
            <Stat
              label="Sharpe"
              value={number(stats.sharpe)}
              hint="Zero risk-free rate"
            />
            <Stat label="Sortino" value={number(stats.sortino)} />
            <Stat
              label="Max drawdown"
              value={<span className="negative">{pct(stats.maxDrawdown)}</span>}
            />
            <Stat label="Calmar" value={number(stats.calmar)} />
            <Stat label="Exposure" value={pct(stats.exposure, 0)} />
            <Stat label="Trades" value={stats.trades} />
            <Stat label="Win rate" value={pct(stats.winRate, 0)} />
            <Stat label="Profit factor" value={number(stats.profitFactor)} />
          </dl>
          <div className="quant-chart quant-chart-tall">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                syncId="btst"
                margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis
                  dataKey="time"
                  tickFormatter={dateTick(years)}
                  tick={axisTick}
                  minTickGap={50}
                  axisLine={false}
                  tickLine={false}
                  hide
                />
                <YAxis
                  orientation="right"
                  width={56}
                  tick={axisTick}
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine y={0} stroke="var(--strong-border)" />
                <Tooltip
                  content={<ChartTip format={(v) => percent(v)} />}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="hold"
                  name="Buy & hold"
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 3"
                  dot={false}
                  strokeWidth={1.1}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="strategy"
                  name="Strategy"
                  stroke="var(--term-header)"
                  dot={false}
                  strokeWidth={1.8}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="quant-chart quant-chart-short">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                syncId="btst"
                margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
              >
                <XAxis
                  dataKey="time"
                  tickFormatter={dateTick(years)}
                  tick={axisTick}
                  minTickGap={50}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  orientation="right"
                  width={56}
                  tick={axisTick}
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={<ChartTip format={(v) => pct(v)} />}
                  isAnimationActive={false}
                />
                <Area
                  dataKey="drawdown"
                  name="Strategy drawdown"
                  stroke="var(--loss)"
                  fill="var(--loss)"
                  fillOpacity={0.18}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="holdDrawdown"
                  name="Hold drawdown"
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 3"
                  dot={false}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <details className="quant-trades">
            <summary>
              {result.trades.length} trades
              <button
                type="button"
                className="chip"
                onClick={(event) => {
                  event.preventDefault();
                  downloadCsv(
                    result.trades.map((trade) => ({
                      side: trade.side,
                      entry: fullDate(trade.entry),
                      entryPrice: trade.entryPrice,
                      exit: trade.exit ? fullDate(trade.exit) : "open",
                      exitPrice: trade.exitPrice ?? "",
                      pnlPercent: trade.pnl,
                    })),
                    `${ticker}-BTST-trades`,
                  );
                }}
              >
                Export CSV
              </button>
            </summary>
            <div className="desk-table-wrap term-table-wrap">
              <table className="data-table term-table">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Entry</th>
                    <th className="num">Price</th>
                    <th>Exit</th>
                    <th className="num">Price</th>
                    <th className="num">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.trades].reverse().map((trade) => (
                    <tr key={trade.entry}>
                      <td>{trade.side}</td>
                      <td>{fullDate(trade.entry)}</td>
                      <td className="num">{amount(trade.entryPrice)}</td>
                      <td>{trade.exit ? fullDate(trade.exit) : "Open"}</td>
                      <td className="num">{amount(trade.exitPrice)}</td>
                      <td className={`num ${tone(trade.pnl)}`}>
                        {percent(trade.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <p className="term-source">
        Signals act at the close and are held over the next bar; costs are
        charged per unit of turnover. Hypothetical results on adjusted daily
        closes, without slippage, borrow or financing costs.
      </p>
    </div>
  );
}
