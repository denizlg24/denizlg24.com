"use client";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/ui/chart";
import { ChartNoAxesColumn } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  XAxis,
  YAxis,
} from "recharts";
import { useLocalZone } from "./time";

export type ChartPoint = {
  at: number;
  total: number;
  peak: number;
  dns: number | null;
  connection: number | null;
  tls: number | null;
  transfer: number | null;
};
/**
 * Stacked because the four phases sum to the request: reading the band widths
 * is reading where the time actually went, which a set of overlaid lines hides.
 */
const config = {
  dns: { label: "Name lookup", color: "var(--chart-5)" },
  connection: { label: "Connection", color: "var(--chart-6)" },
  tls: { label: "TLS handshake", color: "var(--chart-4)" },
  transfer: { label: "Data transfer", color: "var(--chart-1)" },
} satisfies ChartConfig;
const series = Object.keys(config) as (keyof typeof config)[];
const duration = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;

export function ResponseChart({
  points,
  from,
  to,
  outages,
}: {
  points: ChartPoint[];
  from: number;
  to: number;
  outages: { from: number; to: number }[];
}) {
  const timeZone = useLocalZone();
  const span = to - from;
  const time = (at: number) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      ...(span > 86400_000
        ? { day: "numeric", month: "short" }
        : { hour: "2-digit", minute: "2-digit" }),
    }).format(at);
  if (!points.length)
    return (
      <div className="flex flex-col items-center gap-2 border-y py-12 text-center">
        <ChartNoAxesColumn
          aria-hidden
          className="size-5 text-muted-foreground/60"
        />
        <p className="text-sm text-muted-foreground">
          No response timings in this range
        </p>
      </div>
    );
  return (
    <ChartContainer config={config} className="aspect-[16/7] w-full">
      <AreaChart data={points} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="at"
          type="number"
          scale="time"
          domain={[from, to]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={40}
          tickFormatter={time}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tickMargin={4}
          tickFormatter={duration}
        />
        {outages.map((outage) => (
          <ReferenceArea
            key={`${outage.from}-${outage.to}`}
            x1={Math.max(from, outage.from)}
            x2={Math.min(to, outage.to)}
            fill="var(--status-critical)"
            fillOpacity={0.12}
            ifOverflow="hidden"
          />
        ))}
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(_, payload) =>
                time(Number(payload?.[0]?.payload?.at ?? from))
              }
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {config[name as keyof typeof config]?.label ?? name}
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {typeof value === "number" ? duration(value) : "—"}
                  </span>
                </div>
              )}
            />
          }
        />
        {series.map((key) => (
          <Area
            key={key}
            dataKey={key}
            type="monotone"
            stackId="phase"
            stroke={`var(--color-${key})`}
            fill={`var(--color-${key})`}
            fillOpacity={0.25}
            strokeWidth={1.5}
            isAnimationActive={false}
            connectNulls={false}
            dot={false}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}
