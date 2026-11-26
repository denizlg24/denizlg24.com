"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  type BarShapeProps,
} from "recharts";
import type { AxisFormat, Chart } from "@/lib/reports/chart";
import {
  asOfLabel,
  formatValue,
  longDate,
  niceTicks,
  parseTime,
  timeTickLabel,
  timeTicks,
} from "@/lib/reports/format";

export type ChartSize = "inline" | "report" | "slide" | "slide-compact";
const fills = (size: ChartSize) => size === "slide" || size === "slide-compact";

type Row = {
  key: string | number;
  values: (number | null)[];
  labels: (string | undefined)[];
};
type Datum = Record<string, number | string | null>;

const color = (index: number) => `var(--viz-${(index % 6) + 1})`;
const keyOf = (index: number) => `s${index}`;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((current) =>
        Math.abs(current.width - width) < 1 &&
        Math.abs(current.height - height) < 1
          ? current
          : { width: Math.floor(width), height: Math.floor(height) },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function buildRows(chart: Chart): Row[] {
  const order: (string | number)[] = [];
  const index = new Map<string | number, Row>();
  const time = chart.x.type === "time";
  chart.series.forEach((series, s) =>
    series.points.forEach((point) => {
      const key = time ? parseTime(point.x) : point.x;
      let row = index.get(key);
      if (!row) {
        row = {
          key,
          values: chart.series.map(() => null),
          labels: chart.series.map(() => undefined),
        };
        index.set(key, row);
        order.push(key);
      }
      row.values[s] = point.y;
      row.labels[s] = point.label;
    }),
  );
  const rows = order.map((key) => index.get(key)!);
  if (chart.x.type !== "category")
    rows.sort((a, b) => Number(a.key) - Number(b.key));
  return rows;
}

function extent(chart: Chart, rows: Row[]) {
  const stacked = chart.kind === "stacked-bar";
  const values = stacked
    ? rows.flatMap((row) => {
        const pos = row.values.reduce<number>(
          (sum, v) => sum + Math.max(0, v ?? 0),
          0,
        );
        const neg = row.values.reduce<number>(
          (sum, v) => sum + Math.min(0, v ?? 0),
          0,
        );
        return [pos, neg];
      })
    : rows.flatMap((row) => row.values.filter((v): v is number => v != null));
  let min = Math.min(...values);
  let max = Math.max(...values);
  const anchored =
    chart.kind === "bar" ||
    chart.kind === "stacked-bar" ||
    chart.kind === "performance" ||
    chart.kind === "area";
  if (anchored) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  } else {
    const pad = (max - min) * 0.06;
    min -= pad;
    max += pad;
  }
  return { min, max };
}

const estimateWidth = (text: string, px: number) => text.length * px * 0.58;

function lastPoint(rows: Row[], s: number) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const value = rows[i].values[s];
    if (value != null) return { key: rows[i].key, value };
  }
  return null;
}

function EndLabels({
  chart,
  rows,
  font,
}: {
  chart: Chart;
  rows: Row[];
  font: number;
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!xScale || !yScale || !plot) return null;
  const gap = font + 4;
  const items = chart.series
    .map((series, s) => {
      const end = lastPoint(rows, s);
      if (!end) return null;
      const x = xScale(end.key);
      const y = yScale(end.value);
      if (x == null || y == null) return null;
      return {
        s,
        x,
        y,
        target: y,
        name: series.name,
        value: formatValue(end.value, chart.y, {
          signed: chart.kind === "performance",
          compact: true,
        }),
      };
    })
    .filter((item) => item !== null)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++)
    if (items[i].target - items[i - 1].target < gap)
      items[i].target = items[i - 1].target + gap;
  const bottom = plot.y + plot.height;
  const overflow = items.length ? items[items.length - 1].target - bottom : 0;
  if (overflow > 0) {
    items[items.length - 1].target -= overflow;
    for (let i = items.length - 2; i >= 0; i--)
      if (items[i + 1].target - items[i].target < gap)
        items[i].target = items[i + 1].target - gap;
  }
  const left = plot.x + plot.width + 10;
  return (
    <g className="rchart-endlabels">
      {items.map((item) => (
        <g key={item.s}>
          <circle
            cx={item.x}
            cy={item.y}
            r={font > 12 ? 5 : 4}
            fill={color(item.s)}
            stroke="var(--background)"
            strokeWidth={2}
          />
          {Math.abs(item.target - item.y) > 2 ? (
            <path
              d={`M${item.x + 6},${item.y} L${left - 4},${item.target}`}
              stroke="var(--strong-border)"
              fill="none"
            />
          ) : null}
          <text
            x={left}
            y={item.target}
            dy="0.35em"
            fontSize={font}
            fill="var(--foreground)"
          >
            <tspan fontWeight={650}>{item.name}</tspan>
            <tspan dx={6} fill="var(--muted-foreground)">
              {item.value}
            </tspan>
          </text>
        </g>
      ))}
    </g>
  );
}

function ScatterLabels({ chart, font }: { chart: Chart; font: number }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!xScale || !yScale) return null;
  return (
    <g className="rchart-pointlabels">
      {chart.series.flatMap((series, s) =>
        series.points.flatMap((point, p) => {
          if (!point.label || point.y == null) return [];
          const x = xScale(point.x);
          const y = yScale(point.y);
          if (x == null || y == null) return [];
          return [
            <text
              key={`${s}-${p}`}
              x={x + 8}
              y={y}
              dy="0.35em"
              fontSize={font - 1}
              fill="var(--foreground)"
            >
              {point.label}
            </text>,
          ];
        }),
      )}
    </g>
  );
}

function BarShape({
  props,
  horizontal,
  signed,
  series,
  labelled,
  font,
  axis,
  stacked,
}: {
  props: BarShapeProps;
  horizontal: boolean;
  signed: boolean;
  series: number;
  labelled: boolean;
  font: number;
  axis: AxisFormat;
  stacked: boolean;
}) {
  const raw = Array.isArray(props.value)
    ? props.value[1] - props.value[0]
    : props.value;
  const x = Math.min(props.x, props.x + props.width);
  const y = Math.min(props.y, props.y + props.height);
  const w = Math.abs(props.width);
  const h = Math.abs(props.height);
  if (!Number.isFinite(raw) || (w < 0.5 && h < 0.5)) return null;
  const negative = raw < 0;
  const fill = signed
    ? negative
      ? "var(--loss)"
      : "var(--gain)"
    : color(series);
  const r = stacked
    ? 0
    : Math.min(3, horizontal ? h / 2 : w / 2, horizontal ? w : h);
  let d: string;
  if (r <= 0) d = `M${x},${y}h${w}v${h}h${-w}Z`;
  else if (!horizontal && !negative)
    d = `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  else if (!horizontal)
    d = `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
  else if (!negative)
    d = `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  else
    d = `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
  const label = labelled
    ? formatValue(raw, axis, {
        signed: axis.format === "percent",
        compact: true,
      })
    : null;
  return (
    <g>
      <path
        d={d}
        fill={fill}
        stroke={stacked ? "var(--background)" : "none"}
        strokeWidth={stacked ? 2 : 0}
      />
      {label ? (
        horizontal ? (
          <text
            x={x + w + 6}
            y={y + h / 2}
            dy="0.35em"
            textAnchor="start"
            fontSize={font}
            fill="var(--foreground)"
          >
            {label}
          </text>
        ) : (
          <text
            x={x + w / 2}
            y={negative ? y + h + font + 2 : y - 6}
            textAnchor="middle"
            fontSize={font}
            fill="var(--foreground)"
          >
            {label}
          </text>
        )
      ) : null}
    </g>
  );
}

function TooltipCard({
  title,
  rows,
}: {
  title: string;
  rows: { name: string; value: string; index: number; extra?: string }[];
}) {
  return (
    <div className="rchart-tooltip">
      <div className="rchart-tooltip-title">{title}</div>
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.index}-${row.name}`}>
              <td>
                <span
                  className="rchart-key"
                  style={{ background: color(row.index) }}
                  aria-hidden
                />
                {row.name}
                {row.extra ? (
                  <span className="rchart-tooltip-extra"> {row.extra}</span>
                ) : null}
              </td>
              <td className="num">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function autoSubtitle(chart: Chart) {
  if (chart.subtitle) return chart.subtitle;
  if (chart.kind === "performance") return "Cumulative return, %";
  if (chart.y.format === "currency") return `Price, ${chart.y.currency}`;
  if (chart.y.format === "percent") return "%";
  return chart.y.label ?? chart.y.unit ?? undefined;
}

function isScatterDatum(
  value: unknown,
): value is { x: number; y: number; label?: string; s: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value &&
    "s" in value &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.s === "number"
  );
}

function Plot({
  chart,
  rows,
  width,
  height,
  size,
}: {
  chart: Chart;
  rows: Row[];
  width: number;
  height: number;
  size: ChartSize;
}) {
  const font = size === "slide" ? 15 : size === "inline" ? 11 : 12;
  const time = chart.x.type === "time";
  const isBar = chart.kind === "bar" || chart.kind === "stacked-bar";
  const stacked = chart.kind === "stacked-bar";
  const scatter = chart.kind === "scatter";
  const single = chart.series.length === 1;
  const categories = rows.map((row) => String(row.key));
  const longest = Math.max(0, ...categories.map((c) => c.length));
  const horizontal =
    isBar &&
    !stacked &&
    (rows.length > 7 || longest > 10 || (width < 420 && rows.length > 4));
  const signed = isBar && single && chart.y.format === "percent" && !stacked;
  const { min, max } = extent(chart, rows);
  const valueTicks = niceTicks(
    min,
    max,
    size === "slide" ? 6 : height < 240 ? 4 : 5,
  );
  const domain: [number, number] = [
    valueTicks[0],
    valueTicks[valueTicks.length - 1],
  ];
  const tickText = (value: number) =>
    formatValue(value, chart.y, {
      compact: true,
      decimals: tickDecimals(valueTicks),
    });
  const lineLike = !isBar && !scatter;
  const endLabels = lineLike && chart.series.length <= 4;
  const labelRoom = endLabels
    ? Math.min(
        width * 0.32,
        Math.max(
          ...chart.series.map((series, s) => {
            const end = lastPoint(rows, s);
            const value = end
              ? formatValue(end.value, chart.y, { signed: true, compact: true })
              : "";
            return estimateWidth(`${series.name}  ${value}`, font) + 22;
          }),
        ),
      )
    : 12;
  const axisWidth = Math.ceil(
    Math.max(...valueTicks.map((t) => estimateWidth(tickText(t), font))) + 18,
  );
  const data: Datum[] = rows.map((row) => {
    const datum: Datum = { key: row.key };
    row.values.forEach((value, s) => {
      datum[keyOf(s)] = value;
    });
    return datum;
  });
  const times = time ? rows.map((row) => Number(row.key)) : [];
  const tMin = times[0] ?? 0;
  const tMax = times[times.length - 1] ?? 0;
  const span = tMax - tMin;
  const xTicks = time
    ? timeTicks(
        tMin,
        tMax,
        Math.max(3, Math.floor((width - axisWidth - labelRoom) / (font * 5.5))),
      )
    : undefined;
  const xFormat: AxisFormat = chart.x.format ?? { format: "number" };
  const scatterX = scatter
    ? niceTicks(
        Math.min(
          ...chart.series.flatMap((s) => s.points.map((p) => Number(p.x))),
        ),
        Math.max(
          ...chart.series.flatMap((s) => s.points.map((p) => Number(p.x))),
        ),
        size === "slide" ? 7 : 5,
      )
    : undefined;
  const crossesZero = domain[0] < 0 && domain[1] > 0;
  const tick = { fontSize: font, fill: "var(--muted-foreground)" };
  const titleFor = (key: string | number) =>
    time ? longDate(Number(key), span <= 5 * 86_400_000) : String(key);

  const valueAxisProps = {
    domain,
    ticks: valueTicks,
    type: "number" as const,
    tickFormatter: tickText,
    tick,
    axisLine: false,
    tickLine: false,
    interval: 0 as const,
  };

  const tooltip = (
    <Tooltip
      cursor={
        isBar
          ? { fill: "var(--muted)", opacity: 0.6 }
          : { stroke: "var(--rule-strong)", strokeWidth: 1 }
      }
      isAnimationActive={false}
      wrapperStyle={{ outline: "none", zIndex: 5 }}
      content={({ active, label, payload }) => {
        if (!active) return null;
        if (scatter) {
          const point: unknown = payload?.[0]?.payload;
          if (!isScatterDatum(point)) return null;
          return (
            <TooltipCard
              title={point.label ?? chart.series[point.s].name}
              rows={[
                {
                  name: chart.x.label ?? "x",
                  value: formatValue(point.x, xFormat),
                  index: point.s,
                },
                {
                  name: chart.y.label ?? "y",
                  value: formatValue(point.y, chart.y),
                  index: point.s,
                },
              ]}
            />
          );
        }
        const row = rows.find((item) => String(item.key) === String(label));
        if (!row) return null;
        const entries = row.values
          .map((value, index) => ({ value, index }))
          .filter((entry) => entry.value != null);
        if (!stacked) entries.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
        return (
          <TooltipCard
            title={titleFor(row.key)}
            rows={entries.map(({ value, index }) => ({
              index,
              name: chart.series[index].name,
              value: formatValue(value, chart.y, {
                signed: chart.kind === "performance" || signed,
              }),
            }))}
          />
        );
      }}
    />
  );

  const margin = {
    top: isBar && !horizontal && single ? font + 10 : 8,
    right:
      horizontal && single
        ? Math.ceil(estimateWidth("+000.0%", font)) + 10
        : labelRoom,
    bottom: 0,
    left: 0,
  };

  if (scatter) {
    const scatterDomain: [number, number] = [
      scatterX![0],
      scatterX![scatterX!.length - 1],
    ];
    return (
      <ComposedChart
        width={width}
        height={height}
        margin={{ ...margin, right: 56 }}
      >
        <CartesianGrid stroke="var(--rule)" vertical={false} />
        <XAxis
          dataKey="x"
          type="number"
          domain={scatterDomain}
          ticks={scatterX}
          tickFormatter={(value: number) =>
            formatValue(value, xFormat, { compact: true })
          }
          tick={tick}
          tickLine={false}
          stroke="var(--rule-strong)"
          allowDataOverflow
        />
        <YAxis dataKey="y" width={axisWidth} {...valueAxisProps} />
        {crossesZero ? (
          <ReferenceLine y={0} stroke="var(--rule-strong)" />
        ) : null}
        {tooltip}
        {chart.series.map((series, s) => (
          <Scatter
            key={s}
            name={series.name}
            data={series.points
              .filter((p) => p.y != null)
              .map((p) => ({ x: Number(p.x), y: p.y, label: p.label, s }))}
            fill={color(s)}
            isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number }) =>
              props.cx == null || props.cy == null ? null : (
                <circle
                  cx={props.cx}
                  cy={props.cy}
                  r={size === "slide" ? 6 : 4.5}
                  fill={color(s)}
                  stroke="var(--background)"
                  strokeWidth={2}
                />
              )
            }
          />
        ))}
        <ScatterLabels chart={chart} font={font} />
      </ComposedChart>
    );
  }

  if (isBar) {
    const labelled = single && rows.length <= 16;
    const thickness = Math.max(
      6,
      Math.min(
        size === "slide" ? 40 : 24,
        (((horizontal ? height : width - axisWidth) /
          Math.max(1, rows.length)) *
          (single ? 0.62 : 0.8)) /
          (stacked ? 1 : chart.series.length),
      ),
    );
    const categoryWidth = Math.min(
      180,
      Math.ceil(Math.max(...categories.map((c) => estimateWidth(c, font)))) +
        12,
    );
    return (
      <ComposedChart
        width={width}
        height={height}
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={margin}
        barCategoryGap={single ? "28%" : "18%"}
        barGap={2}
      >
        <CartesianGrid
          stroke="var(--rule)"
          vertical={horizontal}
          horizontal={!horizontal}
        />
        {horizontal ? (
          <>
            <XAxis {...valueAxisProps} orientation="top" height={font + 12} />
            <YAxis
              dataKey="key"
              type="category"
              width={categoryWidth}
              tick={{ ...tick, fill: "var(--foreground)" }}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            {crossesZero || domain[0] === 0 ? (
              <ReferenceLine x={0} stroke="var(--rule-strong)" />
            ) : null}
          </>
        ) : (
          <>
            <XAxis
              dataKey="key"
              type="category"
              tick={{ ...tick, fill: "var(--foreground)" }}
              tickLine={false}
              axisLine={false}
              interval={0}
              height={font + 14}
            />
            <YAxis width={axisWidth} {...valueAxisProps} />
            <ReferenceLine y={0} stroke="var(--rule-strong)" />
          </>
        )}
        {tooltip}
        {chart.series.map((series, s) => (
          <Bar
            key={s}
            dataKey={keyOf(s)}
            name={series.name}
            stackId={stacked ? "stack" : undefined}
            fill={color(s)}
            maxBarSize={thickness}
            isAnimationActive={false}
            shape={(props: BarShapeProps) => (
              <BarShape
                props={props}
                horizontal={horizontal}
                signed={signed}
                series={s}
                labelled={labelled}
                font={font}
                axis={chart.y}
                stacked={stacked}
              />
            )}
          />
        ))}
      </ComposedChart>
    );
  }

  return (
    <ComposedChart width={width} height={height} data={data} margin={margin}>
      <CartesianGrid stroke="var(--rule)" vertical={false} />
      <XAxis
        dataKey="key"
        type={time ? "number" : "category"}
        scale={time ? "time" : "auto"}
        domain={time ? [tMin, tMax] : undefined}
        ticks={xTicks}
        tickFormatter={(value: number | string) =>
          time
            ? timeTickLabel(Number(value), span, Number(value) === xTicks?.[0])
            : String(value)
        }
        tick={tick}
        tickLine={{ stroke: "var(--strong-border)" }}
        tickSize={4}
        stroke={crossesZero ? "var(--strong-border)" : "var(--rule-strong)"}
        interval={time ? 0 : "preserveStartEnd"}
        minTickGap={8}
        height={font + 14}
        allowDataOverflow
      />
      <YAxis width={axisWidth} {...valueAxisProps} />
      {crossesZero ? (
        <ReferenceLine y={0} stroke="var(--rule-strong)" strokeWidth={1} />
      ) : null}
      {tooltip}
      {chart.series.map((series, s) =>
        chart.kind === "area" ? (
          <Area
            key={s}
            type="linear"
            dataKey={keyOf(s)}
            name={series.name}
            stroke={color(s)}
            strokeWidth={2}
            fill={color(s)}
            fillOpacity={0.1}
            connectNulls
            dot={false}
            activeDot={{
              r: 4,
              stroke: "var(--background)",
              strokeWidth: 2,
              fill: color(s),
            }}
            isAnimationActive={false}
          />
        ) : (
          <Line
            key={s}
            type="linear"
            dataKey={keyOf(s)}
            name={series.name}
            stroke={color(s)}
            strokeWidth={size === "slide" ? 2.5 : 2}
            strokeLinejoin="round"
            strokeLinecap="round"
            connectNulls
            dot={false}
            activeDot={{
              r: size === "slide" ? 5 : 4,
              stroke: "var(--background)",
              strokeWidth: 2,
              fill: color(s),
            }}
            isAnimationActive={false}
          />
        ),
      )}
      {endLabels ? <EndLabels chart={chart} rows={rows} font={font} /> : null}
    </ComposedChart>
  );
}

function tickDecimals(ticks: number[]) {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}

function DataTable({ chart, rows }: { chart: Chart; rows: Row[] }) {
  const time = chart.x.type === "time";
  return (
    <div className="sr-only">
      <table>
        <caption>{chart.title} data</caption>
        <thead>
          <tr>
            <th scope="col">{chart.x.label ?? (time ? "Date" : "Item")}</th>
            {chart.series.map((series) => (
              <th scope="col" key={series.name}>
                {series.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(-60).map((row) => (
            <tr key={String(row.key)}>
              <th scope="row">
                {time
                  ? longDate(Number(row.key), false)
                  : String(row.labels.find(Boolean) ?? row.key)}
              </th>
              {row.values.map((value, s) => (
                <td key={s}>{formatValue(value, chart.y)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartView({
  chart,
  size = "report",
  footer = true,
  actions,
}: {
  chart: Chart;
  size?: ChartSize;
  footer?: boolean;
  actions?: ReactNode;
}) {
  const [ref, box] = useSize<HTMLDivElement>();
  const rows = buildRows(chart);
  const subtitle = autoSubtitle(chart);
  const legend = chart.series.length > 1;
  const fixedHeight =
    size === "inline" ? 220 : box.width && box.width < 520 ? 260 : 320;
  return (
    <figure className="rchart" data-size={fills(size) ? "slide" : size}>
      <figcaption className="rchart-head">
        <div>
          <strong className="rchart-title">{chart.title}</strong>
          {subtitle ? <span className="rchart-sub">{subtitle}</span> : null}
        </div>
        {actions}
      </figcaption>
      {legend ? (
        <ul className="rchart-legend" aria-label="Legend">
          {chart.series.map((series, s) => (
            <li key={series.name}>
              <span
                className={
                  chart.kind === "bar" ||
                  chart.kind === "stacked-bar" ||
                  chart.kind === "scatter"
                    ? "rchart-swatch"
                    : "rchart-line"
                }
                style={{ background: color(s) }}
                aria-hidden
              />
              {series.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        ref={ref}
        className="rchart-plot"
        style={fills(size) ? undefined : { height: fixedHeight }}
        role="img"
        aria-label={`${chart.title}. ${chart.series.map((s) => s.name).join(", ")}.`}
      >
        {box.width > 40 && (!fills(size) || box.height > 60) ? (
          <Plot
            chart={chart}
            rows={rows}
            width={box.width}
            height={fills(size) ? box.height : fixedHeight}
            size={size}
          />
        ) : null}
      </div>
      <DataTable chart={chart} rows={rows} />
      {footer ? (
        <footer className="rchart-foot">
          <span>Source: {chart.source}</span>
          <span>As of {asOfLabel(chart.asOf)}</span>
          {chart.note ? (
            <span className="rchart-note">{chart.note}</span>
          ) : null}
        </footer>
      ) : null}
    </figure>
  );
}
