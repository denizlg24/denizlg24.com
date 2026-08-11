"use client";

import { formatBytes } from "@repo/cloud-ui/format";
import type { MetricSeries } from "@repo/schemas/cloud";
import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Recharts addresses a series through `dataKey`, which it treats as an object
 * path — so a name containing `:` or `.` resolves to a nested lookup that is not
 * there and the line silently draws nothing.
 */
export function seriesKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}

/** Series arrive one array per metric; recharts wants one row per timestamp. */
export function rowsFor(series: MetricSeries[]): Record<string, number>[] {
  const rows = new Map<number, Record<string, number>>();
  for (const item of series) {
    for (const point of item.points) {
      const ts = new Date(point.ts).getTime();
      const row = rows.get(ts) ?? { ts };
      row[seriesKey(item.name)] = point.value;
      rows.set(ts, row);
    }
  }
  return [...rows.values()].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
}

export type MetricFormat = "percent" | "bytes" | "ms" | "count" | "raw";

function formatValue(value: number, format: MetricFormat): string {
  switch (format) {
    case "percent":
      return `${value.toFixed(1)}%`;
    case "bytes":
      return formatBytes(value);
    case "ms":
      return `${value.toFixed(0)}ms`;
    case "count":
      return value.toFixed(value < 10 ? 1 : 0);
    default:
      return value.toFixed(2);
  }
}

function formatTick(value: number, format: MetricFormat): string {
  if (format === "percent") return `${value}%`;
  if (format === "bytes") return formatBytes(value);
  if (format === "ms") return `${Math.round(value)}`;
  return String(Math.round(value * 10) / 10);
}

export function MetricChart({
  title,
  names,
  data,
  format = "raw",
  /**
   * Multiplies every value before display. Request counters are stored per
   * 30-second sample because that is the only representation the averaging
   * rollup preserves; the chart is the right place to turn that back into the
   * per-minute rate anyone actually wants to read.
   */
  scale = 1,
  labels,
}: {
  title: string;
  names: readonly string[];
  data: MetricSeries[];
  format?: MetricFormat;
  scale?: number;
  labels?: Record<string, string>;
}) {
  const rows = useMemo(() => {
    const base = rowsFor(data);
    if (scale === 1) return base;
    return base.map((row) => {
      const scaled: Record<string, number> = { ts: row.ts ?? 0 };
      for (const [column, value] of Object.entries(row)) {
        scaled[column] = column === "ts" ? value : value * scale;
      }
      return scaled;
    });
  }, [data, scale]);

  const hasAny = rows.some((row) =>
    names.some((name) => row[seriesKey(name)] !== undefined),
  );

  return (
    <div className="min-w-0 space-y-2">
      <span className="text-xs font-medium">{title}</span>
      <div className="h-44 border-t pt-3">
        {!hasAny ? (
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
                domain={format === "percent" ? [0, 100] : [0, "auto"]}
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(value) => formatTick(Number(value), format)}
              />
              <Tooltip
                labelFormatter={(value) =>
                  new Date(Number(value)).toLocaleString()
                }
                formatter={(value, name) => [
                  formatValue(Number(value), format),
                  labels?.[String(name)] ?? String(name).split(":").at(-1),
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
                  dataKey={seriesKey(name)}
                  name={name}
                  type="monotone"
                  stroke={`var(--chart-${(index % 6) + 1})`}
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
