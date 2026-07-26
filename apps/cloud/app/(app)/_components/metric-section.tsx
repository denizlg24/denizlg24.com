"use client";

import { formatBytes } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { MetricSeries } from "@repo/schemas/cloud";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { useCallback, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";

export type Range = "24h" | "7d" | "90d";

export const RANGES: Record<Range, { seconds: number; step: number }> = {
  "24h": { seconds: 24 * 3600, step: 300 },
  "7d": { seconds: 7 * 24 * 3600, step: 1800 },
  "90d": { seconds: 90 * 24 * 3600, step: 21_600 },
};

/** Six, because disk io plots three devices as a read/write pair each. */
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

export interface ChartSpec {
  title: string;
  unit: "percent" | "bytesPerSecond" | "celsius";
  series: { name: string; label: string }[];
}

function seriesKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}

function tickFormatter(range: Range): (value: number) => string {
  return (value) => {
    const date = new Date(value);
    if (range === "24h")
      return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
    if (range === "7d")
      return date.toLocaleDateString(undefined, { weekday: "short" });
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };
}

function mergeRows(series: MetricSeries[]): Record<string, number>[] {
  const rows = new Map<number, Record<string, number>>();
  for (const entry of series) {
    const key = seriesKey(entry.name);
    for (const point of entry.points) {
      const ts = new Date(point.ts).getTime();
      const row = rows.get(ts) ?? { ts };
      row[key] = point.value;
      rows.set(ts, row);
    }
  }
  return [...rows.values()].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
}

export function TimeSeriesChart({
  spec,
  series,
  range,
}: {
  spec: ChartSpec;
  series: MetricSeries[];
  range: Range;
}) {
  const rows = useMemo(
    () =>
      mergeRows(
        series.filter((entry) =>
          spec.series.some((wanted) => wanted.name === entry.name),
        ),
      ),
    [series, spec],
  );

  const config: ChartConfig = {};
  spec.series.forEach((entry, index) => {
    config[seriesKey(entry.name)] = {
      label: entry.label,
      color: CHART_COLORS[index % CHART_COLORS.length],
    };
  });

  const multi = spec.series.length > 1;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-xs font-medium">{spec.title}</span>
      {rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
          no samples
        </div>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-40 w-full">
          <LineChart
            data={rows}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={tickFormatter(range)}
              tickLine={false}
              axisLine={false}
              minTickGap={48}
              fontSize={10}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              fontSize={10}
              domain={
                spec.unit === "percent"
                  ? [0, 100]
                  : spec.unit === "celsius"
                    ? [0, 100]
                    : [0, "auto"]
              }
              tickFormatter={(value: number) =>
                spec.unit === "percent"
                  ? `${value}%`
                  : spec.unit === "celsius"
                    ? `${value}°`
                    : `${formatBytes(value)}/s`
              }
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const ts = payload?.[0]?.payload?.ts;
                    return typeof ts === "number"
                      ? new Date(ts).toLocaleString()
                      : "";
                  }}
                  formatter={(value, name, item) => (
                    <>
                      <span
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ background: item.color }}
                      />
                      <span className="text-muted-foreground">
                        {config[name as string]?.label ?? name}
                      </span>
                      <span className="ml-auto font-mono tabular-nums">
                        {spec.unit === "percent"
                          ? `${Number(value).toFixed(1)}%`
                          : spec.unit === "celsius"
                            ? `${Number(value).toFixed(1)}°C`
                            : `${formatBytes(Number(value))}/s`}
                      </span>
                    </>
                  )}
                />
              }
            />
            {spec.series.map((entry) => (
              <Line
                key={entry.name}
                dataKey={seriesKey(entry.name)}
                type="monotone"
                stroke={`var(--color-${seriesKey(entry.name)})`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      )}
      {multi && rows.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {spec.series.map((entry, index) => (
            <span
              key={entry.name}
              className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground"
            >
              <span
                className="size-2 shrink-0 rounded-[2px]"
                style={{
                  background: CHART_COLORS[index % CHART_COLORS.length],
                }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A titled grid of charts sharing one range selector and one metrics request.
 * Callers usually derive `specs` from polled data, so the array gets a fresh
 * identity every tick; the fetch is keyed on the joined series names instead,
 * which absorbs that churn and keeps usePoll's interval from restarting.
 */
export function MetricSection({
  title,
  specs,
  columns = 2,
  defaultRange = "24h",
}: {
  title: string;
  specs: ChartSpec[];
  columns?: 1 | 2;
  defaultRange?: Range;
}) {
  const [range, setRange] = useState<Range>(defaultRange);

  // Keying the fetch on a joined string keeps `fetchMetrics` stable across
  // polls of whatever produced `specs`.
  const seriesParam = useMemo(
    () =>
      specs.flatMap((spec) => spec.series.map((entry) => entry.name)).join(","),
    [specs],
  );

  const fetchMetrics = useCallback(() => {
    const { seconds, step } = RANGES[range];
    const to = new Date();
    const from = new Date(to.getTime() - seconds * 1000);
    return api.ops.metrics({
      series: seriesParam.split(","),
      from: from.toISOString(),
      to: to.toISOString(),
      step,
    });
  }, [range, seriesParam]);

  const { data, error } = usePoll(fetchMetrics, 60_000);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Tabs value={range} onValueChange={(value) => setRange(value as Range)}>
          <TabsList variant="line">
            {(Object.keys(RANGES) as Range[]).map((key) => (
              <TabsTrigger key={key} value={key} className="text-xs">
                {key}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div
        className={
          columns === 2
            ? "grid gap-x-8 gap-y-6 md:grid-cols-2"
            : "grid gap-x-8 gap-y-6"
        }
      >
        {specs.map((spec) => (
          <TimeSeriesChart
            key={spec.title}
            spec={spec}
            series={data?.series ?? []}
            range={range}
          />
        ))}
      </div>
    </section>
  );
}
