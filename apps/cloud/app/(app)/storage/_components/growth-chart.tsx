"use client";

import { formatBytes } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { useCallback, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";

type Range = "24h" | "7d" | "90d";

const RANGES: Record<Range, { seconds: number; step: number }> = {
  "24h": { seconds: 24 * 3600, step: 300 },
  "7d": { seconds: 7 * 24 * 3600, step: 1800 },
  "90d": { seconds: 90 * 24 * 3600, step: 21_600 },
};

const SERIES = "storage:total_bytes";
const FILES_SERIES = "storage:file_count";

const config: ChartConfig = {
  bytes: { label: "stored", color: "var(--chart-1)" },
};

function tickFormatter(range: Range): (value: number) => string {
  return (value) => {
    const date = new Date(value);
    if (range === "24h") {
      return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    if (range === "7d") {
      return date.toLocaleDateString(undefined, { weekday: "short" });
    }
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };
}

export function GrowthChart() {
  const [range, setRange] = useState<Range>("7d");

  const fetchMetrics = useCallback(() => {
    const { seconds, step } = RANGES[range];
    const to = new Date();
    const from = new Date(to.getTime() - seconds * 1_000);
    return api.ops.metrics({
      series: [SERIES, FILES_SERIES],
      from: from.toISOString(),
      to: to.toISOString(),
      step,
    });
  }, [range]);

  const { data, error } = usePoll(fetchMetrics, 5 * 60_000);

  const rows = useMemo(() => {
    const bytes = data?.series.find((entry) => entry.name === SERIES);
    const files = data?.series.find((entry) => entry.name === FILES_SERIES);
    const byTs = new Map<
      number,
      { ts: number; bytes: number; files?: number }
    >();
    for (const point of bytes?.points ?? []) {
      const ts = new Date(point.ts).getTime();
      byTs.set(ts, { ts, bytes: point.value });
    }
    for (const point of files?.points ?? []) {
      const ts = new Date(point.ts).getTime();
      const row = byTs.get(ts);
      if (row) row.files = point.value;
    }
    return [...byTs.values()].sort((a, b) => a.ts - b.ts);
  }, [data]);

  const delta = useMemo(() => {
    const first = rows[0]?.bytes;
    const last = rows[rows.length - 1]?.bytes;
    if (first === undefined || last === undefined) return null;
    return last - first;
  }, [rows]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between border-b pb-2">
        <h2 className="text-sm font-semibold">
          growth
          {delta !== null && (
            <span className="ml-2 font-normal tabular-nums text-muted-foreground">
              {delta >= 0 ? "+" : "−"}
              {formatBytes(Math.abs(delta))}
            </span>
          )}
        </h2>
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
      {rows.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
          no samples
        </div>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-48 w-full">
          <AreaChart
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
              width={60}
              tickLine={false}
              axisLine={false}
              fontSize={10}
              domain={[0, "auto"]}
              tickFormatter={(value: number) => formatBytes(value)}
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
                  formatter={(value, _name, item) => (
                    <>
                      <span
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ background: item.color }}
                      />
                      <span className="text-muted-foreground">stored</span>
                      <span className="ml-auto font-mono tabular-nums">
                        {formatBytes(Number(value))}
                        {typeof item.payload?.files === "number" && (
                          <span className="ml-2 text-muted-foreground">
                            {item.payload.files} files
                          </span>
                        )}
                      </span>
                    </>
                  )}
                />
              }
            />
            <Area
              dataKey="bytes"
              type="monotone"
              stroke="var(--color-bytes)"
              fill="var(--color-bytes)"
              fillOpacity={0.12}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </section>
  );
}
