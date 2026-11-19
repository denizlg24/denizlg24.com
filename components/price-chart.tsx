"use client";

import { useId } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPoint } from "@/lib/models";
import type { Range } from "@/lib/universes";
import { amount, compact } from "@/lib/utils";

type Style = "area" | "candles";
type Entry = ChartPoint & { span: [number, number]; sma: number | null };
const shortDate = (value: number, range: Range) =>
  new Intl.DateTimeFormat(
    "en-GB",
    range === "1D"
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "short", day: "numeric" },
  ).format(value * 1000);

function candle({
  x,
  y,
  width,
  height,
  payload,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: Entry;
}) {
  if (
    !payload ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  )
    return null;
  const fill = payload.close >= payload.open ? "var(--gain)" : "var(--loss)";
  const span = payload.high - payload.low;
  const yPrice = (price: number) =>
    span === 0 ? y : y + ((payload.high - price) / span) * height;
  const center = x + width / 2;
  const bodyWidth = Math.max(1, Math.min(10, width * 0.75));
  return (
    <g>
      <line x1={center} x2={center} y1={y} y2={y + height} stroke={fill} />
      <rect
        x={center - bodyWidth / 2}
        y={Math.min(yPrice(payload.open), yPrice(payload.close))}
        width={bodyWidth}
        height={Math.max(
          1,
          Math.abs(yPrice(payload.open) - yPrice(payload.close)),
        )}
        fill={fill}
        rx={0.5}
      />
    </g>
  );
}

export default function PriceChart({
  points,
  range,
  style,
  average,
  volume,
  currency,
}: {
  points: ChartPoint[];
  range: Range;
  style: Style;
  average: boolean;
  volume: boolean;
  currency?: string;
}) {
  const gradient = useId().replaceAll(":", "");
  const values: Entry[] = points.map((point, i) => ({
    ...point,
    span: [point.low, point.high],
    sma:
      i < 19
        ? null
        : points
            .slice(i - 19, i + 1)
            .reduce((sum, item) => sum + item.close, 0) / 20,
  }));
  const priceColor =
    (points.at(-1)?.close ?? 0) >= (points[0]?.close ?? 0)
      ? "var(--gain)"
      : "var(--loss)";
  return (
    <div className="price-chart" aria-label={`${range} price chart`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart
          data={values}
          margin={{ top: 13, right: 4, left: 2, bottom: 4 }}
        >
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={priceColor} stopOpacity={0.22} />
              <stop offset="100%" stopColor={priceColor} stopOpacity={0.005} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeDasharray="3 4"
          />
          <XAxis
            dataKey="time"
            tickFormatter={(value) => shortDate(value, range)}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            minTickGap={32}
            tickMargin={11}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            width={65}
            tickFormatter={(value) => compact(value)}
            domain={["auto", "auto"]}
            tickCount={5}
            tickMargin={10}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          {volume ? (
            <YAxis
              yAxisId="volume"
              hide
              domain={[0, (max: number) => max * 5 || 1]}
            />
          ) : null}
          <Tooltip
            cursor={{
              stroke: "var(--muted-foreground)",
              strokeDasharray: "4 3",
            }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as Entry | undefined;
              if (!active || !point) return null;
              return (
                <div className="chart-tip">
                  <strong>{shortDate(point.time, range)}</strong>
                  <span>
                    Close {amount(point.close)} {currency}
                  </span>
                  <span>
                    Open {amount(point.open)} · High {amount(point.high)} · Low{" "}
                    {amount(point.low)}
                  </span>
                  {point.volume != null ? (
                    <span>Volume {compact(point.volume)}</span>
                  ) : null}
                </div>
              );
            }}
          />
          {volume ? (
            <Bar
              yAxisId="volume"
              dataKey="volume"
              fill="var(--muted-foreground)"
              opacity={0.18}
              isAnimationActive={false}
            />
          ) : null}
          {style === "area" ? (
            <Area
              yAxisId="price"
              type="linear"
              dataKey="close"
              stroke={priceColor}
              strokeWidth={2.2}
              fill={`url(#${gradient})`}
              isAnimationActive={false}
              activeDot={{
                r: 4,
                fill: priceColor,
                stroke: "var(--card)",
                strokeWidth: 2,
              }}
            />
          ) : (
            <Bar
              yAxisId="price"
              dataKey="span"
              shape={candle}
              fill={priceColor}
              isAnimationActive={false}
            />
          )}
          {average ? (
            <Line
              yAxisId="price"
              dataKey="sma"
              name="20-bar SMA"
              stroke="var(--chart-2)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
