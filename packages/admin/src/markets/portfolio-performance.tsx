"use client";

import type { Portfolio, PortfolioPerformance } from "@repo/markets/schemas";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { useEffect, useMemo, useState } from "react";
import { type CurveSeries, EquityChart } from "./equity-chart";
import {
  assignSeriesColors,
  BENCHMARK_COLOR,
  OTHER_COLOR,
  OTHER_KEY,
  PORTFOLIO_COLOR,
  splitByPalette,
} from "./series-palette";

/**
 * `value` is the book as a whole against its benchmark. The other two decompose
 * it: `pnl` splits the total into what each symbol contributed, in currency, and
 * the lines sum back to the total. `return` measures each symbol against only
 * its own money, which is the view that shows a +300% position hiding inside a
 * flat portfolio — and which deliberately does not sum to anything.
 */
type ChartMode = "value" | "pnl" | "return";

const MODES: { value: ChartMode; label: string }[] = [
  { value: "value", label: "Value" },
  { value: "pnl", label: "PnL" },
  { value: "return", label: "Return" },
];

const PORTFOLIO_KEY = "__portfolio";
const BENCHMARK_KEY = "__benchmark";

/**
 * `live` is the observed intraday series rather than a slice of the daily
 * curve — the only view that moves within a session, and the only one a
 * portfolio opened this morning has more than one point on.
 */
type Range = "live" | "1M" | "6M" | "1Y" | "ALL";

const RANGES: { value: Range; label: string; days: number | null }[] = [
  { value: "live", label: "Live", days: null },
  { value: "1M", label: "1M", days: 30 },
  { value: "6M", label: "6M", days: 182 },
  { value: "1Y", label: "1Y", days: 365 },
  { value: "ALL", label: "All", days: null },
];

/** Oldest date to keep for a range, or null to keep everything. */
function cutoffFor(range: Range): string | null {
  const days = RANGES.find((item) => item.value === range)?.days ?? null;
  if (days === null) return null;
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export interface PortfolioPerformanceChartProps {
  portfolio: Portfolio;
  performance: PortfolioPerformance;
}

export function PortfolioPerformanceChart({
  portfolio,
  performance,
}: PortfolioPerformanceChartProps) {
  const [mode, setMode] = useState<ChartMode>("value");
  const [range, setRange] = useState<Range>("live");
  const [normalize, setNormalize] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // The live view is the default, but a portfolio with no observations yet has
  // nothing to draw there — a book restored from a backup, or one whose page has
  // never been open. Falling back keeps the chart from opening empty.
  const live = performance.intradayCurve;
  const effectiveRange: Range =
    range === "live" && live.length < 2 ? "ALL" : range;

  // The server ranks contributions by absolute PnL, so hues follow that ranking
  // rather than whatever is currently visible.
  const { named, pooled } = useMemo(
    () => splitByPalette(performance.contributions),
    [performance.contributions],
  );
  const colors = useMemo(
    () => assignSeriesColors(named.map((item) => item.ticker)),
    [named],
  );

  // A symbol sold out of the book entirely should not keep a stale toggle alive.
  useEffect(() => {
    const live = new Set(performance.contributions.map((item) => item.ticker));
    setHidden((current) => {
      const next = new Set(
        [...current].filter((key) => live.has(key) || key.startsWith("__")),
      );
      return next.size === current.size ? current : next;
    });
  }, [performance.contributions]);

  const chips = useMemo(() => {
    const base = [
      { key: PORTFOLIO_KEY, label: portfolio.name, color: PORTFOLIO_COLOR },
      ...named.map((item) => ({
        key: item.ticker,
        label: item.ticker,
        color: colors.get(item.ticker) ?? OTHER_COLOR,
      })),
    ];
    // Averaging percent returns across a pool needs each symbol's invested
    // basis, which the currency view does not have to reconstruct — so the
    // pooled series is offered only where summing is exact.
    if (pooled.length > 0 && mode === "pnl") {
      base.push({
        key: OTHER_KEY,
        label: `Other ${pooled.length}`,
        color: OTHER_COLOR,
      });
    }
    return base;
  }, [portfolio.name, named, pooled, colors, mode]);

  const series = useMemo<CurveSeries[]>(() => {
    // Observed points carry the portfolio's own totals but no per-symbol
    // breakdown — nothing prices a single holding minute by minute — so the
    // live view is one line in every mode.
    if (effectiveRange === "live") {
      return [
        {
          key: PORTFOLIO_KEY,
          label: portfolio.name,
          color: PORTFOLIO_COLOR,
          emphasis: true,
          points: live.map((point) => ({
            date: point.ts,
            value:
              mode === "value"
                ? point.value
                : mode === "pnl"
                  ? point.totalPnl
                  : point.totalPnlPercent,
          })),
        },
      ];
    }

    const cutoff = cutoffFor(effectiveRange);
    const within = <T extends { date: string }>(points: T[]) =>
      cutoff === null ? points : points.filter((point) => point.date >= cutoff);
    const curve = within(performance.curve);
    if (curve.length === 0) return [];

    if (mode === "value") {
      const result: CurveSeries[] = [
        {
          key: PORTFOLIO_KEY,
          label: portfolio.name,
          color: PORTFOLIO_COLOR,
          emphasis: true,
          points: curve.map((point) => ({
            date: point.date,
            value: point.value,
          })),
        },
      ];
      // A benchmark index level and a portfolio balance share no axis, so the
      // comparison only exists once both are rebased.
      if (normalize && performance.benchmarkCurve.length > 0) {
        const start = curve[0]?.date ?? "";
        result.push({
          key: BENCHMARK_KEY,
          label: portfolio.benchmark ?? "Benchmark",
          color: BENCHMARK_COLOR,
          dashed: true,
          points: performance.benchmarkCurve.filter(
            (point) => point.date >= start,
          ),
        });
      }
      return result;
    }

    const result: CurveSeries[] = [];

    if (!hidden.has(PORTFOLIO_KEY)) {
      result.push({
        key: PORTFOLIO_KEY,
        label: portfolio.name,
        color: PORTFOLIO_COLOR,
        emphasis: true,
        points: curve.map((point) => ({
          date: point.date,
          value: mode === "pnl" ? point.totalPnl : point.totalPnlPercent,
        })),
      });
    }

    for (const item of named) {
      if (hidden.has(item.ticker)) continue;
      result.push({
        key: item.ticker,
        label: item.ticker,
        color: colors.get(item.ticker) ?? OTHER_COLOR,
        points: within(item.points).map((point) => ({
          date: point.date,
          value: mode === "pnl" ? point.pnl : point.returnPercent,
        })),
      });
    }

    if (mode === "pnl" && pooled.length > 0 && !hidden.has(OTHER_KEY)) {
      const byDate = new Map<string, number>();
      for (const item of pooled) {
        for (const point of within(item.points)) {
          byDate.set(point.date, (byDate.get(point.date) ?? 0) + point.pnl);
        }
      }
      result.push({
        key: OTHER_KEY,
        label: `Other ${pooled.length}`,
        color: OTHER_COLOR,
        points: [...byDate]
          .map(([date, value]) => ({ date, value }))
          .sort((a, b) => (a.date < b.date ? -1 : 1)),
      });
    }

    return result;
  }, [
    mode,
    effectiveRange,
    live,
    normalize,
    hidden,
    named,
    pooled,
    colors,
    performance,
    portfolio.name,
    portfolio.benchmark,
  ]);

  const toggle = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // The live view is a single absolute series, so there is nothing to rebase
  // against and the axis stays in the mode's own units.
  const rebased = mode === "value" && normalize && effectiveRange !== "live";
  const percentAxis = mode === "return" || rebased;

  return (
    <div className="shrink-0 border-b">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as ChartMode)}
        >
          <TabsList variant="line" className="h-7">
            {MODES.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="px-2 text-xs"
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="ml-auto flex items-center gap-1">
          {RANGES.map((item) => {
            const on = effectiveRange === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setRange(item.value)}
                aria-pressed={on}
                className={`rounded border px-1.5 py-0.5 text-[10px] tabular-nums ${
                  on
                    ? "border-foreground/30 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            );
          })}
          {mode === "value" && effectiveRange !== "live" ? (
            <button
              type="button"
              onClick={() => setNormalize((current) => !current)}
              aria-pressed={normalize}
              className={`ml-1 rounded border px-1.5 py-0.5 text-[10px] tabular-nums ${
                normalize
                  ? "border-foreground/30 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              %
            </button>
          ) : null}
        </div>
      </div>

      {/* One line, and the chips would toggle series that do not exist here. */}
      {effectiveRange === "live" ? (
        <div className="flex flex-wrap items-center gap-3 px-4 pt-1.5 text-[10px]">
          <Legend color={PORTFOLIO_COLOR} label={portfolio.name} />
        </div>
      ) : mode === "value" ? (
        <div className="flex flex-wrap items-center gap-3 px-4 pt-1.5 text-[10px]">
          <Legend color={PORTFOLIO_COLOR} label={portfolio.name} />
          {rebased && portfolio.benchmark ? (
            <Legend
              color={BENCHMARK_COLOR}
              label={portfolio.benchmark}
              dashed
            />
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1 px-4 pt-1.5">
          {chips.map((chip) => {
            const on = !hidden.has(chip.key);
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => toggle(chip.key)}
                aria-pressed={on}
                className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                  on
                    ? "border-foreground/20 text-foreground"
                    : "border-transparent text-muted-foreground/60 hover:text-muted-foreground"
                }`}
              >
                <span
                  className="inline-block h-0.5 w-2.5 rounded"
                  style={{
                    background: on ? chip.color : "currentColor",
                    opacity: on ? 1 : 0.5,
                  }}
                />
                {chip.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="px-2 pt-1 pb-2">
        {series.length === 0 ? (
          <div className="px-2 py-8 text-muted-foreground text-xs">—</div>
        ) : (
          <EquityChart
            series={series}
            normalize={rebased}
            format={percentAxis ? "percent" : "price"}
            baseline={mode !== "value"}
            // Every live point falls inside one day, so a date axis would print
            // the same label the whole way across.
            timeVisible={effectiveRange === "live"}
            height={260}
            fitKey={`${portfolio.id}:${mode}:${effectiveRange}:${rebased}`}
          />
        )}
      </div>
    </div>
  );
}

function Legend({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span
        className="inline-block h-0.5 w-3 rounded"
        style={
          dashed
            ? {
                backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 5px)`,
              }
            : { background: color }
        }
      />
      {label}
    </span>
  );
}
