"use client";

import {
  Area,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  bandFor,
  bandLabel,
  type FearGreedPoint,
  score1,
} from "@/lib/fear-greed-model";

const isPoint = (value: unknown): value is FearGreedPoint =>
  typeof value === "object" &&
  value !== null &&
  "time" in value &&
  "score" in value &&
  typeof value.time === "number" &&
  typeof value.score === "number";

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "short" });
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function monthStarts(history: FearGreedPoint[]) {
  if (history.length < 2) return [];
  const first = new Date(history[0].time);
  const last = history[history.length - 1].time;
  const ticks: number[] = [];
  for (
    let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
    cursor <= last;
    cursor = Date.UTC(
      new Date(cursor).getUTCFullYear(),
      new Date(cursor).getUTCMonth() + 1,
      1,
    )
  )
    ticks.push(cursor);
  return ticks;
}

export default function FearGreedChart({
  history,
}: {
  history: FearGreedPoint[];
}) {
  return (
    <div className="fg-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={history}
          margin={{ top: 6, right: 0, bottom: 0, left: 0 }}
        >
          {[25, 45, 55, 75].map((level) => (
            <ReferenceLine
              key={level}
              y={level}
              stroke="var(--rule)"
              strokeDasharray="3 3"
            />
          ))}
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) => monthFormat.format(value)}
            ticks={monthStarts(history)}
            tickLine={false}
            axisLine={{ stroke: "var(--strong-border)" }}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <YAxis
            orientation="right"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            width={28}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: "var(--strong-border)" }}
            content={({ active, payload }) => {
              const item = payload?.[0]?.payload;
              if (!active || !isPoint(item)) return null;
              return (
                <div className="chart-tip">
                  <span>{dayFormat.format(item.time)}</span>
                  <strong>{score1(item.score)}</strong>
                  <span>{bandLabel(bandFor(item.score).key)}</span>
                </div>
              );
            }}
          />
          <Area
            dataKey="score"
            type="monotone"
            stroke="var(--foreground)"
            strokeWidth={1.5}
            fill="var(--muted)"
            fillOpacity={0.6}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3, fill: "var(--foreground)", stroke: "none" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
