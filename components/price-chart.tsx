"use client";

import { useId, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPoint } from "@/lib/models";
import type { Range } from "@/lib/universes";
import { amount, compact, percent, tone } from "@/lib/utils";

type Style = "area" | "candles";
type Entry = ChartPoint & { span: [number, number]; sma: number | null };
const shortDate = (value: number, range: Range) =>
  new Intl.DateTimeFormat(
    "en-GB",
    range === "1D"
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "short", day: "numeric" },
  ).format(value * 1000);
const longDate = (value: number, range: Range) =>
  new Intl.DateTimeFormat(
    "en-GB",
    range === "1D" || range === "5D"
      ? {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }
      : { weekday: "short", day: "numeric", month: "short", year: "numeric" },
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

const axisPrice = (value: number) =>
  Math.abs(value) >= 10_000
    ? Math.round(value).toLocaleString("en-US")
    : amount(value);

function PriceTag({
  viewBox,
  value,
}: {
  viewBox?: { x?: number; y?: number; width?: number };
  value: number;
}) {
  if (viewBox?.x == null || viewBox.y == null || viewBox.width == null)
    return null;
  const x = viewBox.x + viewBox.width + 2;
  return (
    <g className="price-tag">
      <rect x={x} y={viewBox.y - 9} width={62} height={18} rx={2} />
      <text x={x + 6} y={viewBox.y + 4}>
        {axisPrice(value)}
      </text>
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
  const [hover, setHover] = useState<number | null>(null);
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
  const first = values[0];
  const active = (hover != null ? values[hover] : undefined) ?? values.at(-1);
  const priceColor =
    (points.at(-1)?.close ?? 0) >= (points[0]?.close ?? 0)
      ? "var(--gain)"
      : "var(--loss)";
  const fromStart =
    active && first?.close ? (active.close / first.close - 1) * 100 : null;
  return (
    <>
      <dl className="chart-readout" aria-live="off">
        {active ? (
          <>
            <div className="readout-date">
              <dt className="sr-only">Date</dt>
              <dd>{longDate(active.time, range)}</dd>
            </div>
            {(
              [
                ["O", active.open],
                ["H", active.high],
                ["L", active.low],
                ["C", active.close],
              ] as const
            ).map(([label, price]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{amount(price)}</dd>
              </div>
            ))}
            {active.volume != null ? (
              <div>
                <dt>Vol</dt>
                <dd>{compact(active.volume)}</dd>
              </div>
            ) : null}
            {average && active.sma != null ? (
              <div className="readout-sma">
                <dt>SMA</dt>
                <dd>{amount(active.sma)}</dd>
              </div>
            ) : null}
            <div>
              <dt>From start</dt>
              <dd className={tone(fromStart)}>{percent(fromStart)}</dd>
            </div>
            {currency ? <div className="readout-unit">{currency}</div> : null}
          </>
        ) : null}
      </dl>
      <div className="price-chart" aria-label={`${range} price chart`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart
            data={values}
            margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
            onMouseMove={(state) => {
              const index = Number(state.activeTooltipIndex);
              setHover(
                state.isTooltipActive && Number.isInteger(index) ? index : null,
              );
            }}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={priceColor} stopOpacity={0.14} />
                <stop offset="100%" stopColor={priceColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--rule)" />
            <XAxis
              dataKey="time"
              tickFormatter={(value) => shortDate(value, range)}
              axisLine={{ stroke: "var(--strong-border)" }}
              tickLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              minTickGap={40}
              tickMargin={7}
              height={24}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              width={66}
              tickFormatter={axisPrice}
              domain={["auto", "auto"]}
              tickCount={6}
              tickMargin={8}
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
              content={() => null}
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              isAnimationActive={false}
            />
            {volume ? (
              <Bar
                yAxisId="volume"
                dataKey="volume"
                fill="var(--muted-foreground)"
                opacity={0.2}
                isAnimationActive={false}
              />
            ) : null}
            {style === "area" ? (
              <Area
                yAxisId="price"
                type="linear"
                dataKey="close"
                stroke={priceColor}
                strokeWidth={1.6}
                fill={`url(#${gradient})`}
                isAnimationActive={false}
                activeDot={{
                  r: 3.5,
                  fill: priceColor,
                  stroke: "var(--background)",
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
                strokeWidth={1.25}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ) : null}
            {hover != null && active ? (
              <ReferenceLine
                yAxisId="price"
                y={active.close}
                stroke="var(--muted-foreground)"
                strokeDasharray="2 3"
                ifOverflow="hidden"
                label={(props: {
                  viewBox?: { x?: number; y?: number; width?: number };
                }) => <PriceTag viewBox={props.viewBox} value={active.close} />}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
