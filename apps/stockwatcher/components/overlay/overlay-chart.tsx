"use client";

import { useId, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import useSWR from "swr";
import { api, Empty, Failure, Loading } from "@/components/shared";
import type { FearGreedHistoryResponse } from "@/lib/fear-greed-model";
import { type Bar, computeStudies, studyInfo } from "@/lib/indicators";
import type { MarketSeries } from "@/lib/models";
import {
  alignSeries,
  evaluate,
  isFearGreed,
  isFred,
  type Observation,
  type OverlayRange,
  type OverlaySeries,
  parseExpression,
  relation,
  scaler,
} from "@/lib/overlay";
import type { MacroHistory } from "@/lib/security-types";
import { amount, compact, number } from "@/lib/utils";

export const seriesColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--term-key)",
  "var(--muted-foreground)",
];

const rangeMonths: Record<OverlayRange, number> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  YTD: 0,
  "1Y": 12,
  "5Y": 60,
};
function visibleStart(range: OverlayRange) {
  const date = new Date();
  if (range === "YTD") return `${date.getUTCFullYear()}-01-01`;
  date.setUTCMonth(date.getUTCMonth() - rangeMonths[range]);
  return date.toISOString().slice(0, 10);
}
const dayKey = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10);

type Loaded = {
  market: Map<string, Observation[]>;
  stepped: Map<string, Observation[]>;
  starts: string[];
  failed: { id: string; message: string }[];
  sources: string[];
};

async function loadSeries(ids: string[], range: OverlayRange): Promise<Loaded> {
  const start = visibleStart(range);
  const warm = new Date(`${start}T00:00:00Z`);
  warm.setUTCDate(warm.getUTCDate() - 420);
  const result: Loaded = {
    market: new Map(),
    stepped: new Map(),
    starts: [],
    failed: [],
    sources: [],
  };
  await Promise.all(
    ids.map(async (id) => {
      try {
        if (isFearGreed(id)) {
          const data = await api<FearGreedHistoryResponse>(
            "/api/market/fear-greed/history",
          );
          const from = warm.toISOString().slice(0, 10);
          result.stepped.set(
            id,
            data.days
              .filter((row) => row.day >= from)
              .map((row) => ({ date: row.day, value: row.score })),
          );
          result.sources.push(data.source);
          return;
        }
        if (isFred(id)) {
          const series = id.slice(5);
          const data = await api<MacroHistory>(
            `/api/security?${new URLSearchParams({ macro: series, from: warm.toISOString().slice(0, 10) })}`,
          );
          result.stepped.set(
            id,
            data.observations.map((row) => ({
              date: row.date,
              value: row.value,
            })),
          );
          result.sources.push("FRED");
          return;
        }
        const data = await api<MarketSeries>(
          `/api/market?${new URLSearchParams({ symbol: id, range, warmup: "1" })}`,
        );
        if (!data.points.length) throw new Error("No history");
        result.market.set(
          id,
          data.points.map((point) => ({
            date: dayKey(point.time),
            value: point.close,
          })),
        );
        const first = data.points[data.lead ?? 0];
        if (first) result.starts.push(dayKey(first.time));
        if (data.source) result.sources.push(data.source);
      } catch (error) {
        result.failed.push({
          id,
          message: error instanceof Error ? error.message : "Unavailable",
        });
      }
    }),
  );
  if (!result.starts.length) result.starts.push(start);
  return result;
}

type Row = Record<string, number | string | [number, number] | null>;
type Built = {
  rows: Row[];
  stats: ({ correlation: number; beta: number; days: number } | null)[];
  last: (number | null)[];
};

function build(series: OverlaySeries[], loaded: Loaded): Built | null {
  const { dates, columns } = alignSeries(loaded.market, loaded.stepped);
  if (!dates.length) return null;
  const start = loaded.starts.toSorted()[0];
  const from = Math.max(
    0,
    dates.findIndex((date) => date >= start),
  );
  const rows: Row[] = dates.map((date) => ({ date }));
  const raw: (number | null)[][] = [];
  series.forEach((item, s) => {
    const parsed = parseExpression(item.expr);
    const values = parsed.ok
      ? dates.map((_, i) =>
          evaluate(parsed.expr, (id) => columns.get(id)?.[i] ?? null),
        )
      : dates.map(() => null);
    raw.push(values);
    const scale = scaler(values, item.mode, from);
    const present = values.flatMap((value, i) =>
      value == null ? [] : [{ i, value }],
    );
    const bars: Bar[] = present.map(({ i, value }) => ({
      time: i,
      open: value,
      high: value,
      low: value,
      close: value,
      volume: null,
    }));
    const studied = computeStudies(bars, item.studies);
    present.forEach(({ i, value }, j) => {
      rows[i][`s${s}`] = scale(value);
      for (const [key, study] of Object.entries(studied[j])) {
        const name = `s${s}_${key}`;
        if (study == null) rows[i][name] = null;
        else if (Array.isArray(study)) {
          const low = scale(study[0]);
          const high = scale(study[1]);
          rows[i][name] = low == null || high == null ? null : [low, high];
        } else
          rows[i][name] = ["rsi", "macd", "macdSignal", "macdHist"].includes(
            key,
          )
            ? study
            : scale(study);
      }
    });
  });
  const visible = raw.map((values) => values.slice(from));
  return {
    rows: rows.slice(from),
    stats: visible.map((values, s) =>
      s === 0 ? null : relation(visible[0], values),
    ),
    last: raw.map(
      (values) => values.findLast((value) => value != null) ?? null,
    ),
  };
}

const format = (
  value: number | null | undefined,
  mode: OverlaySeries["mode"],
) =>
  value == null
    ? "—"
    : mode === "rebased"
      ? `${value > 0 ? "+" : ""}${amount(value)}%`
      : mode === "zscore"
        ? `${number(value)}σ`
        : Math.abs(value) >= 100_000
          ? compact(value)
          : amount(value);

const shortDate = (date: string, range: OverlayRange) =>
  new Intl.DateTimeFormat(
    "en-GB",
    range === "5Y"
      ? { month: "short", year: "2-digit" }
      : { day: "numeric", month: "short" },
  ).format(new Date(`${date}T12:00:00Z`));

export function OverlayChart({
  series,
  range,
  compact: small = false,
}: {
  series: OverlaySeries[];
  range: OverlayRange;
  compact?: boolean;
}) {
  const sync = useId();
  const [hover, setHover] = useState<number | null>(null);
  const ids = [
    ...new Set(
      series.flatMap((item) => {
        const parsed = parseExpression(item.expr);
        return parsed.ok ? parsed.ids : [];
      }),
    ),
  ].sort();
  const { data, error, isLoading, mutate } = useSWR(
    ids.length ? ["overlay", ids.join(","), range] : null,
    () => loadSeries(ids, range),
    { revalidateOnFocus: false, refreshInterval: 300_000 },
  );
  const built = useMemo(
    () => (data ? build(series, data) : null),
    [data, series],
  );
  if (!series.length)
    return (
      <Empty title="Add a series to start">
        Try ^GSPC, then overlay ^VIX on the right axis inverted.
      </Empty>
    );
  if (error) return <Failure error={error} retry={() => void mutate()} />;
  if (isLoading || !data) return <Loading message="Loading series" />;
  if (!built) return <Empty title="No overlapping history for these series" />;

  const active = built.rows[hover ?? built.rows.length - 1];
  const axisOf = (item: OverlaySeries, s: number) =>
    item.invert ? `inv${s}` : item.axis === "right" ? "right" : "left";
  const main = series
    .map((item, s) => ({ item, s }))
    .filter(({ item }) => item.axis !== "pane");
  const panes = [
    ...series
      .map((item, s) => ({ item, s, kind: "series" as const }))
      .filter(({ item }) => item.axis === "pane"),
    ...series.flatMap((item, s) =>
      item.studies
        .filter((key) => key === "rsi" || key === "macd")
        .map((key) => ({ item, s, kind: key })),
    ),
  ];
  const usesLeft = main.some(
    ({ item }) => !item.invert && item.axis === "left",
  );
  const usesRight = main.some(
    ({ item }) => !item.invert && item.axis === "right",
  );
  const onMove = (state: {
    activeTooltipIndex?: number | string | null;
    isTooltipActive?: boolean;
  }) => {
    const index = Number(state.activeTooltipIndex);
    setHover(state.isTooltipActive && Number.isInteger(index) ? index : null);
  };
  const tick = { fill: "var(--muted-foreground)", fontSize: 11 };
  const xAxis = (visible: boolean) => (
    <XAxis
      dataKey="date"
      hide={!visible}
      tickFormatter={(value: string) => shortDate(value, range)}
      tick={tick}
      axisLine={{ stroke: "var(--strong-border)" }}
      tickLine={false}
      minTickGap={48}
      height={visible ? 24 : 0}
    />
  );
  const lastPane = panes.length - 1;

  return (
    <div className="overlay-chart" data-compact={small || undefined}>
      <dl className="overlay-readout">
        <div className="readout-date">
          <dd>{typeof active?.date === "string" ? active.date : ""}</dd>
        </div>
        {series.map((item, s) => {
          const value = active?.[`s${s}`];
          return (
            <div
              key={s}
              style={{ color: seriesColors[s % seriesColors.length] }}
            >
              <dt>{item.expr}</dt>
              <dd>
                {format(typeof value === "number" ? value : null, item.mode)}
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="overlay-main">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart
            data={built.rows}
            syncId={sync}
            margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <CartesianGrid vertical={false} stroke="var(--rule)" />
            {xAxis(panes.length === 0)}
            <YAxis
              yAxisId="left"
              hide={!usesLeft}
              width={usesLeft ? 60 : 0}
              domain={["auto", "auto"]}
              tick={tick}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value: number) => compactAxis(value)}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              hide={!usesRight}
              width={usesRight ? 60 : 0}
              domain={["auto", "auto"]}
              tick={tick}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value: number) => compactAxis(value)}
            />
            {main
              .filter(({ item }) => item.invert)
              .map(({ item, s }) => (
                <YAxis
                  key={`inv${s}`}
                  yAxisId={`inv${s}`}
                  orientation={item.axis === "right" ? "right" : "left"}
                  reversed
                  width={56}
                  domain={["auto", "auto"]}
                  tick={{
                    ...tick,
                    fill: seriesColors[s % seriesColors.length],
                  }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value: number) => compactAxis(value)}
                />
              ))}
            <Tooltip
              content={() => null}
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              isAnimationActive={false}
            />
            {series.some((item) => item.mode !== "price") ? (
              <ReferenceLine
                yAxisId={
                  usesLeft
                    ? "left"
                    : usesRight
                      ? "right"
                      : `inv${main[0]?.s ?? 0}`
                }
                y={0}
                stroke="var(--strong-border)"
                strokeDasharray="3 3"
              />
            ) : null}
            {main.flatMap(({ item, s }) => {
              const color = seriesColors[s % seriesColors.length];
              const axis = axisOf(item, s);
              const studyLines = item.studies
                .filter((key) => key !== "rsi" && key !== "macd")
                .flatMap((key) =>
                  key === "bollinger"
                    ? [
                        <Area
                          key={`s${s}bb`}
                          yAxisId={axis}
                          dataKey={`s${s}_bbBand`}
                          stroke="none"
                          fill={color}
                          fillOpacity={0.08}
                          activeDot={false}
                          isAnimationActive={false}
                        />,
                        <Line
                          key={`s${s}bbm`}
                          yAxisId={axis}
                          dataKey={`s${s}_bbMid`}
                          stroke={color}
                          strokeOpacity={0.6}
                          strokeDasharray="3 3"
                          dot={false}
                          activeDot={false}
                          isAnimationActive={false}
                        />,
                      ]
                    : [
                        <Line
                          key={`s${s}${key}`}
                          yAxisId={axis}
                          dataKey={`s${s}_${key}`}
                          stroke={color}
                          strokeOpacity={0.7}
                          strokeWidth={1}
                          strokeDasharray={
                            key.startsWith("ema") ? "5 3" : "2 2"
                          }
                          dot={false}
                          activeDot={false}
                          isAnimationActive={false}
                        />,
                      ],
                );
              return [
                ...studyLines,
                <Line
                  key={`s${s}`}
                  yAxisId={axis}
                  dataKey={`s${s}`}
                  type="linear"
                  stroke={color}
                  strokeWidth={1.6}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />,
              ];
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {small
        ? null
        : panes.map((pane, index) => {
            const color = seriesColors[pane.s % seriesColors.length];
            const key = `pane-${pane.kind}-${pane.s}`;
            return (
              <div
                key={key}
                className="study-pane"
                data-last={index === lastPane || undefined}
              >
                <div className="study-legend">
                  <strong style={{ color }}>
                    {pane.kind === "series"
                      ? pane.item.expr
                      : `${studyInfo.get(pane.kind)?.short} · ${pane.item.expr}`}
                  </strong>
                </div>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <ComposedChart
                    data={built.rows}
                    syncId={sync}
                    margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
                    onMouseMove={onMove}
                    onMouseLeave={() => setHover(null)}
                  >
                    <CartesianGrid vertical={false} stroke="var(--rule)" />
                    {xAxis(index === lastPane)}
                    <YAxis
                      orientation="right"
                      width={60}
                      reversed={pane.kind === "series" && pane.item.invert}
                      domain={pane.kind === "rsi" ? [0, 100] : ["auto", "auto"]}
                      tick={tick}
                      tickCount={3}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value: number) => compactAxis(value)}
                    />
                    <Tooltip
                      content={() => null}
                      cursor={{ stroke: "var(--muted-foreground)" }}
                      isAnimationActive={false}
                    />
                    {pane.kind === "rsi"
                      ? [70, 30].map((level) => (
                          <ReferenceLine
                            key={level}
                            y={level}
                            stroke="var(--strong-border)"
                            strokeDasharray="3 3"
                          />
                        ))
                      : null}
                    {pane.kind === "series" ? (
                      <Line
                        dataKey={`s${pane.s}`}
                        stroke={color}
                        strokeWidth={1.4}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ) : pane.kind === "rsi" ? (
                      <Line
                        dataKey={`s${pane.s}_rsi`}
                        stroke={color}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ) : (
                      [
                        <Line
                          key="m"
                          dataKey={`s${pane.s}_macd`}
                          stroke={color}
                          dot={false}
                          isAnimationActive={false}
                        />,
                        <Line
                          key="g"
                          dataKey={`s${pane.s}_macdSignal`}
                          stroke="var(--muted-foreground)"
                          dot={false}
                          isAnimationActive={false}
                        />,
                      ]
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            );
          })}
      {small ? null : (
        <div className="overlay-foot">
          {series.length > 1 ? (
            <ul
              className="overlay-stats"
              aria-label="Relationship to the first series"
            >
              {series.slice(1).map((item, i) => {
                const stat = built.stats[i + 1];
                return (
                  <li key={i}>
                    <i
                      style={{
                        background: seriesColors[(i + 1) % seriesColors.length],
                      }}
                      aria-hidden
                    />
                    {item.expr} vs {series[0].expr}:{" "}
                    {stat ? (
                      <>
                        ρ <b>{number(stat.correlation)}</b> · β{" "}
                        <b>{number(stat.beta)}</b>{" "}
                        <small>({stat.days} days of changes)</small>
                      </>
                    ) : (
                      "not enough overlapping data"
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <span className="term-source">
            {[...new Set(data.sources)].join(" · ")}
            {data.failed.length
              ? ` · unavailable: ${data.failed.map((item) => item.id).join(", ")}`
              : ""}
            {series.some((item) => isFredExpr(item.expr))
              ? " · FRED values carried forward between releases"
              : ""}
          </span>
        </div>
      )}
    </div>
  );
}

const isFredExpr = (expr: string) => expr.includes("FRED:");
const compactAxis = (value: number) =>
  Math.abs(value) >= 10_000 ? compact(value) : number(value);
