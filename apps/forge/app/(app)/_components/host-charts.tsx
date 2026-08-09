"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import type { MetricSeries } from "@repo/schemas/cloud";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback, useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";

const SERIES = [
  "forge-host:cpu.usage_percent",
  "forge-host:memory.usage_percent",
  "forge-host:disk.usage_percent",
  "forge-host:load.1",
] as const;

function key(name: string) {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}

function rowsFor(series: MetricSeries[]) {
  const rows = new Map<number, Record<string, number>>();
  for (const item of series) {
    for (const point of item.points) {
      const ts = new Date(point.ts).getTime();
      const row = rows.get(ts) ?? { ts };
      row[key(item.name)] = point.value;
      rows.set(ts, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.ts - b.ts);
}

function MetricChart({
  title,
  names,
  data,
  percent = false,
}: {
  title: string;
  names: readonly string[];
  data: MetricSeries[];
  percent?: boolean;
}) {
  const rows = useMemo(() => rowsFor(data), [data]);
  return (
    <div className="min-w-0 space-y-2">
      <span className="text-xs font-medium">{title}</span>
      <div className="h-44 border-t pt-3">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            no samples yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 8, left: -20 }}>
              <CartesianGrid vertical={false} strokeDasharray="2 2" />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(value) =>
                  new Date(value).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={percent ? [0, 100] : [0, "auto"]}
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) =>
                  percent ? `${value}%` : String(value)
                }
              />
              <Tooltip
                labelFormatter={(value) =>
                  new Date(Number(value)).toLocaleString()
                }
                formatter={(value, name) => [
                  percent
                    ? `${Number(value).toFixed(1)}%`
                    : Number(value).toFixed(2),
                  String(name).split(":").at(-1),
                ]}
                contentStyle={{
                  background: "var(--background)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 11,
                }}
              />
              {names.map((name, index) => (
                <Line
                  key={name}
                  dataKey={key(name)}
                  name={name}
                  type="monotone"
                  stroke={`var(--chart-${index + 1})`}
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export function HostCharts() {
  const fetchMetrics = useCallback(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1_000);
    return api.forge.metrics({
      series: [...SERIES],
      from: from.toISOString(),
      to: to.toISOString(),
      step: 300,
    });
  }, []);
  const { data, error } = usePoll(fetchMetrics, 60_000);
  if (!data) {
    return error ? (
      <p className="text-xs text-destructive">metrics: {error}</p>
    ) : (
      <div className="grid gap-8 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        last 24 hours
      </h2>
      <div className="grid gap-8 md:grid-cols-2">
        <MetricChart
          title="utilization"
          names={SERIES.slice(0, 3)}
          data={data.series}
          percent
        />
        <MetricChart
          title="load average"
          names={[SERIES[3]]}
          data={data.series}
        />
      </div>
    </section>
  );
}
