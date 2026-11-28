"use client";

import {
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { bandFor, bandLabel, bands, score1 } from "@/lib/fear-greed-model";

export type HistoryRow = { time: number; score: number; spx: number | null };

const isRow = (value: unknown): value is HistoryRow =>
  typeof value === "object" &&
  value !== null &&
  "time" in value &&
  "score" in value &&
  typeof value.time === "number" &&
  typeof value.score === "number";

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const shortFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});
const level = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 0 });

const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };

export default function FearGreedHistoryChart({
  rows,
  showSpx,
}: {
  rows: HistoryRow[];
  showSpx: boolean;
}) {
  const span = rows.length > 1 ? rows[rows.length - 1].time - rows[0].time : 0;
  const short = span < 200 * 86_400_000;
  return (
    <div className="fgm-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
        >
          {bands.map((band) => (
            <ReferenceArea
              key={band.key}
              yAxisId="score"
              y1={band.min}
              y2={band.max}
              fill={`var(--fg-${band.key})`}
              fillOpacity={0.08}
              stroke="none"
              ifOverflow="hidden"
            />
          ))}
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) =>
              (short ? shortFormat : monthFormat).format(value)
            }
            minTickGap={48}
            tickLine={false}
            axisLine={{ stroke: "var(--strong-border)" }}
            tick={axisTick}
          />
          <YAxis
            yAxisId="score"
            orientation="left"
            domain={[0, 100]}
            ticks={[0, 25, 45, 55, 75, 100]}
            width={28}
            tickLine={false}
            axisLine={false}
            tick={axisTick}
          />
          {showSpx ? (
            <YAxis
              yAxisId="spx"
              orientation="right"
              domain={["auto", "auto"]}
              width={52}
              tickFormatter={level}
              tickLine={false}
              axisLine={false}
              tick={axisTick}
            />
          ) : null}
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: "var(--strong-border)" }}
            content={({ active, payload }) => {
              const item = payload?.[0]?.payload;
              if (!active || !isRow(item)) return null;
              return (
                <div className="chart-tip fgm-tip">
                  <span>{dayFormat.format(item.time)}</span>
                  <strong data-band={bandFor(item.score).key}>
                    {score1(item.score)} · {bandLabel(bandFor(item.score).key)}
                  </strong>
                  {showSpx && item.spx != null ? (
                    <span>S&amp;P 500 {level(item.spx)}</span>
                  ) : null}
                </div>
              );
            }}
          />
          {showSpx ? (
            <Line
              yAxisId="spx"
              dataKey="spx"
              type="monotone"
              stroke="var(--chart-2)"
              strokeWidth={1.2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ) : null}
          <Line
            yAxisId="score"
            dataKey="score"
            type="monotone"
            stroke="var(--foreground)"
            strokeWidth={1.6}
            dot={false}
            activeDot={{ r: 3, fill: "var(--foreground)", stroke: "none" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
