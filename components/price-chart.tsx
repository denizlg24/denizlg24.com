"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
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
import type { ChartPoint, ChartStyle } from "@/lib/models";
import type { Range } from "@/lib/universes";
import {
  computeStudies,
  heikinAshi,
  studyInfo,
  type StudyKey,
  type StudyRow,
} from "@/lib/indicators";
import { amount, compact, percent, tone } from "@/lib/utils";

type Entry = ChartPoint & {
  span: [number, number];
  prior: number | null;
  actual: ChartPoint;
} & { [study: string]: StudyRow[string] | ChartPoint };

const intraday = (range: Range) => range === "1D" || range === "5D";
const shortDate = (value: number, range: Range) =>
  new Intl.DateTimeFormat(
    "en-GB",
    range === "1D"
      ? { hour: "2-digit", minute: "2-digit" }
      : range === "5Y"
        ? { month: "short", year: "2-digit" }
        : { month: "short", day: "numeric" },
  ).format(value * 1000);
const longDate = (value: number, range: Range) =>
  new Intl.DateTimeFormat(
    "en-GB",
    intraday(range)
      ? {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }
      : { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  ).format(value * 1000);

const axisPrice = (value: number) =>
  Math.abs(value) >= 10_000
    ? Math.round(value).toLocaleString("en-US")
    : amount(value);
const axisStudy = (value: number) =>
  Math.abs(value) >= 10_000 ? compact(value) : amount(value);

type ShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: Entry;
};

function priceShape(mode: "candles" | "hollow" | "bars", log: boolean) {
  return function PriceBar({ x, y, width, height, payload }: ShapeProps) {
    if (
      !payload ||
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined
    )
      return null;
    const up = payload.close >= payload.open;
    const color = up ? "var(--gain)" : "var(--loss)";
    const scale = log ? Math.log : (value: number) => value;
    const top = scale(payload.high);
    const span = top - scale(payload.low);
    const yPrice = (price: number) =>
      span === 0 ? y : y + ((top - scale(price)) / span) * height;
    const center = x + width / 2;
    const body = Math.max(1, Math.min(10, width * 0.75));
    if (mode === "bars") {
      const tick = Math.max(2, body / 2);
      return (
        <g stroke={color} strokeWidth={1.2}>
          <line x1={center} x2={center} y1={y} y2={y + height} />
          <line
            x1={center - tick}
            x2={center}
            y1={yPrice(payload.open)}
            y2={yPrice(payload.open)}
          />
          <line
            x1={center}
            x2={center + tick}
            y1={yPrice(payload.close)}
            y2={yPrice(payload.close)}
          />
        </g>
      );
    }
    const hollow = mode === "hollow" && up;
    const bodyTop = Math.min(yPrice(payload.open), yPrice(payload.close));
    const bodyHeight = Math.max(
      1,
      Math.abs(yPrice(payload.open) - yPrice(payload.close)),
    );
    return (
      <g>
        <line
          x1={center}
          x2={center}
          y1={y}
          y2={hollow ? bodyTop : y + height}
          stroke={color}
        />
        {hollow ? (
          <line
            x1={center}
            x2={center}
            y1={bodyTop + bodyHeight}
            y2={y + height}
            stroke={color}
          />
        ) : null}
        <rect
          x={center - body / 2}
          y={bodyTop}
          width={body}
          height={bodyHeight}
          fill={hollow ? "var(--card)" : color}
          stroke={color}
          strokeWidth={hollow ? 1 : 0}
        />
      </g>
    );
  };
}

function signedBar(key: "volume" | "macdHist") {
  return function SignedBar({ x, y, width, height, payload }: ShapeProps) {
    if (
      !payload ||
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined
    )
      return null;
    const up =
      key === "volume"
        ? payload.actual.close >= (payload.prior ?? payload.actual.open)
        : Number(payload.macdHist ?? 0) >= 0;
    return (
      <rect
        x={x + width * 0.1}
        y={height < 0 ? y + height : y}
        width={Math.max(1, width * 0.8)}
        height={Math.abs(height)}
        fill={up ? "var(--gain)" : "var(--loss)"}
        opacity={key === "volume" ? 0.45 : 0.7}
      />
    );
  };
}

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

/** Stable colours so a study keeps its colour across charts and the legend. */
export const studyColors: Partial<Record<StudyKey, string>> = {
  sma20: "var(--chart-3)",
  sma50: "var(--chart-2)",
  sma100: "var(--chart-4)",
  sma200: "var(--chart-6)",
  ema9: "var(--chart-5)",
  ema21: "var(--chart-4)",
  ema50: "var(--chart-1)",
  bollinger: "var(--chart-3)",
  keltner: "var(--chart-5)",
  donchian: "var(--chart-4)",
  ichimoku: "var(--chart-2)",
  vwap: "var(--chart-2)",
  psar: "var(--chart-4)",
  prevClose: "var(--muted-foreground)",
};

const overlayLine = (
  key: string,
  color: string,
  options: { width?: number; dash?: string; opacity?: number } = {},
) => (
  <Line
    key={key}
    yAxisId="price"
    dataKey={key}
    stroke={color}
    strokeWidth={options.width ?? 1.2}
    strokeDasharray={options.dash}
    strokeOpacity={options.opacity ?? 1}
    dot={false}
    activeDot={false}
    connectNulls={false}
    isAnimationActive={false}
  />
);

function overlays(key: StudyKey): ReactNode {
  const color = studyColors[key] ?? "var(--chart-1)";
  switch (key) {
    case "sma20":
    case "sma50":
    case "sma100":
    case "sma200":
    case "ema9":
    case "ema21":
    case "ema50":
      return overlayLine(key, color, { width: key === "sma200" ? 1.6 : 1.2 });
    case "vwap":
      return overlayLine("vwap", color, { dash: "4 2" });
    case "bollinger":
      return [
        <Area
          key="bbBand"
          yAxisId="price"
          dataKey="bbBand"
          stroke="none"
          fill={color}
          fillOpacity={0.07}
          isAnimationActive={false}
          activeDot={false}
        />,
        overlayLine("bbUpper", color, { width: 1 }),
        overlayLine("bbLower", color, { width: 1 }),
        overlayLine("bbMid", color, { width: 1, dash: "3 3", opacity: 0.8 }),
      ];
    case "keltner":
      return [
        overlayLine("kcUpper", color, { width: 1, dash: "5 3" }),
        overlayLine("kcLower", color, { width: 1, dash: "5 3" }),
        overlayLine("kcMid", color, { width: 1, opacity: 0.6 }),
      ];
    case "donchian":
      return [
        <Area
          key="dcBand"
          yAxisId="price"
          dataKey="dcBand"
          stroke="none"
          fill={color}
          fillOpacity={0.05}
          isAnimationActive={false}
          activeDot={false}
        />,
        overlayLine("dcUpper", color, { width: 1 }),
        overlayLine("dcLower", color, { width: 1 }),
      ];
    case "ichimoku":
      return [
        <Area
          key="ichiCloud"
          yAxisId="price"
          dataKey="ichiCloud"
          stroke="none"
          fill={color}
          fillOpacity={0.1}
          isAnimationActive={false}
          activeDot={false}
        />,
        overlayLine("ichiConversion", "var(--chart-3)", { width: 1 }),
        overlayLine("ichiBase", "var(--chart-6)", { width: 1 }),
        overlayLine("ichiSpanA", "var(--gain)", { width: 0.8, opacity: 0.6 }),
        overlayLine("ichiSpanB", "var(--loss)", { width: 0.8, opacity: 0.6 }),
      ];
    case "psar":
      return (
        <Line
          key="psar"
          yAxisId="price"
          dataKey="psar"
          stroke="none"
          dot={{ r: 1.3, fill: color, stroke: "none" }}
          activeDot={false}
          isAnimationActive={false}
        />
      );
    default:
      return null;
  }
}

type PaneSpec = {
  key: StudyKey;
  domain?: [number, number];
  levels?: number[];
  lines: { key: string; color: string; label: string }[];
  histogram?: "volume" | "macdHist";
};

const paneSpecs: Partial<Record<StudyKey, PaneSpec>> = {
  volume: {
    key: "volume",
    lines: [{ key: "volumeAvg", color: "var(--chart-3)", label: "Avg 20" }],
    histogram: "volume",
  },
  rsi: {
    key: "rsi",
    domain: [0, 100],
    levels: [70, 30],
    lines: [{ key: "rsi", color: "var(--chart-4)", label: "RSI" }],
  },
  macd: {
    key: "macd",
    levels: [0],
    histogram: "macdHist",
    lines: [
      { key: "macd", color: "var(--chart-2)", label: "MACD" },
      { key: "macdSignal", color: "var(--chart-3)", label: "Signal" },
    ],
  },
  stoch: {
    key: "stoch",
    domain: [0, 100],
    levels: [80, 20],
    lines: [
      { key: "stochK", color: "var(--chart-2)", label: "%K" },
      { key: "stochD", color: "var(--chart-3)", label: "%D" },
    ],
  },
  atr: {
    key: "atr",
    lines: [{ key: "atr", color: "var(--chart-5)", label: "ATR" }],
  },
  adx: {
    key: "adx",
    levels: [25],
    lines: [
      { key: "adx", color: "var(--chart-3)", label: "ADX" },
      { key: "plusDI", color: "var(--gain)", label: "+DI" },
      { key: "minusDI", color: "var(--loss)", label: "−DI" },
    ],
  },
  obv: {
    key: "obv",
    lines: [{ key: "obv", color: "var(--chart-2)", label: "OBV" }],
  },
  cci: {
    key: "cci",
    levels: [100, -100],
    lines: [{ key: "cci", color: "var(--chart-4)", label: "CCI" }],
  },
  williams: {
    key: "williams",
    domain: [-100, 0],
    levels: [-20, -80],
    lines: [{ key: "williams", color: "var(--chart-5)", label: "%R" }],
  },
  mfi: {
    key: "mfi",
    domain: [0, 100],
    levels: [80, 20],
    lines: [{ key: "mfi", color: "var(--chart-6)", label: "MFI" }],
  },
};

const readoutLines: Partial<Record<StudyKey, { key: string; label: string }[]>> =
  {
    bollinger: [
      { key: "bbUpper", label: "BB↑" },
      { key: "bbLower", label: "BB↓" },
    ],
    keltner: [
      { key: "kcUpper", label: "KC↑" },
      { key: "kcLower", label: "KC↓" },
    ],
    donchian: [
      { key: "dcUpper", label: "DC↑" },
      { key: "dcLower", label: "DC↓" },
    ],
    ichimoku: [
      { key: "ichiConversion", label: "Tenkan" },
      { key: "ichiBase", label: "Kijun" },
    ],
  };

const numberAt = (entry: Entry | undefined, key: string) => {
  const value = entry?.[key];
  return typeof value === "number" ? value : null;
};

const margin = { top: 6, right: 0, left: 0, bottom: 0 };
const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };

export default function PriceChart({
  points,
  lead = 0,
  range,
  style,
  studies = [],
  log = false,
  previousClose,
  currency,
  compact: small = false,
}: {
  points: ChartPoint[];
  lead?: number;
  range: Range;
  style: ChartStyle;
  studies?: StudyKey[];
  log?: boolean;
  previousClose?: number | null;
  currency?: string;
  compact?: boolean;
}) {
  const gradient = useId().replaceAll(":", "");
  const sync = useId();
  const [hover, setHover] = useState<number | null>(null);
  const studyKey = studies.join(",");
  const values = useMemo(() => {
    const keys = studyKey ? (studyKey.split(",") as StudyKey[]) : [];
    const rows = computeStudies(points, keys);
    const shown = style === "heikin" ? heikinAshi(points) : points;
    return shown.slice(lead).map((point, offset): Entry => {
      const i = offset + lead;
      return {
        ...point,
        ...rows[i],
        span: [point.low, point.high],
        prior: i > 0 ? points[i - 1].close : null,
        actual: points[i],
      };
    });
  }, [points, lead, style, studyKey]);

  const priceStudies = studies.filter(
    (key) => studyInfo.get(key)?.pane === "price",
  );
  const panes = small
    ? []
    : studies.flatMap((key) => (paneSpecs[key] ? [paneSpecs[key]] : []));
  const first = values[0];
  const active = (hover != null ? values[hover] : undefined) ?? values.at(-1);
  const bar = active?.actual;
  const priceColor =
    (values.at(-1)?.close ?? 0) >= (first?.close ?? 0)
      ? "var(--gain)"
      : "var(--loss)";
  const rangeChange =
    bar && first?.actual.close
      ? (bar.close / first.actual.close - 1) * 100
      : null;
  const barChange =
    bar && active?.prior ? (bar.close / active.prior - 1) * 100 : null;
  const showPrev =
    studies.includes("prevClose") && previousClose != null && previousClose > 0;
  const candleLike =
    style === "candles" ||
    style === "hollow" ||
    style === "bars" ||
    style === "heikin";
  const lastPane = panes.at(-1)?.key;
  const onMove = (state: {
    activeTooltipIndex?: number | string | null;
    isTooltipActive?: boolean;
  }) => {
    const index = Number(state.activeTooltipIndex);
    setHover(state.isTooltipActive && Number.isInteger(index) ? index : null);
  };

  const xAxis = (visible: boolean) => (
    <XAxis
      dataKey="time"
      hide={!visible}
      tickFormatter={(value) => shortDate(value, range)}
      axisLine={{ stroke: "var(--strong-border)" }}
      tickLine={false}
      tick={axisTick}
      minTickGap={40}
      tickMargin={7}
      height={visible ? 24 : 0}
    />
  );

  return (
    <>
      <dl className="chart-readout" aria-live="off">
        {active && bar ? (
          <>
            <div className="readout-date">
              <dt className="sr-only">Date</dt>
              <dd>{longDate(active.time, range)}</dd>
            </div>
            {(
              [
                ["O", bar.open],
                ["H", bar.high],
                ["L", bar.low],
                ["C", bar.close],
              ] as const
            ).map(([label, price]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{amount(price)}</dd>
              </div>
            ))}
            {barChange != null ? (
              <div>
                <dt>Chg</dt>
                <dd className={tone(barChange)}>{percent(barChange)}</dd>
              </div>
            ) : null}
            {bar.volume != null ? (
              <div>
                <dt>Vol</dt>
                <dd>{compact(bar.volume)}</dd>
              </div>
            ) : null}
            <div>
              <dt title={`Change since the first bar of the ${range} window`}>
                {range}
              </dt>
              <dd className={tone(rangeChange)}>{percent(rangeChange)}</dd>
            </div>
            {priceStudies.flatMap((key) => {
              const lines = readoutLines[key] ?? [
                { key, label: studyInfo.get(key)?.short ?? key },
              ];
              return lines.flatMap((line) => {
                const value = numberAt(active, line.key);
                return value == null ? [] : (
                    <div
                      key={line.key}
                      className="readout-study"
                      style={{ color: studyColors[key] }}
                    >
                      <dt>{line.label}</dt>
                      <dd>{amount(value)}</dd>
                    </div>
                  );
              });
            })}
            {currency ? <div className="readout-unit">{currency}</div> : null}
          </>
        ) : null}
      </dl>
      <div
        className="price-chart-stack"
        data-panes={panes.length}
        aria-label={`${range} price chart`}
      >
        <div className="price-pane">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart
              data={values}
              syncId={sync}
              margin={{ ...margin, top: 10 }}
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
            >
              <defs>
                <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={priceColor} stopOpacity={0.14} />
                  <stop offset="100%" stopColor={priceColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--rule)" />
              {xAxis(!lastPane)}
              <YAxis
                yAxisId="price"
                orientation="right"
                width={66}
                scale={log ? "log" : "auto"}
                tickFormatter={axisPrice}
                domain={["auto", "auto"]}
                allowDataOverflow={false}
                tickCount={6}
                tickMargin={8}
                axisLine={false}
                tickLine={false}
                tick={axisTick}
              />
              {small && studies.includes("volume") ? (
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
              {small && studies.includes("volume") ? (
                <Bar
                  yAxisId="volume"
                  dataKey="volume"
                  fill="var(--muted-foreground)"
                  opacity={0.2}
                  isAnimationActive={false}
                />
              ) : null}
              {priceStudies.map((key) => overlays(key))}
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
              ) : style === "line" ? (
                <Line
                  yAxisId="price"
                  type="linear"
                  dataKey="close"
                  stroke={priceColor}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{
                    r: 3,
                    fill: priceColor,
                    stroke: "var(--background)",
                    strokeWidth: 2,
                  }}
                />
              ) : candleLike ? (
                <Bar
                  yAxisId="price"
                  dataKey="span"
                  shape={priceShape(
                    style === "bars"
                      ? "bars"
                      : style === "hollow"
                        ? "hollow"
                        : "candles",
                    log,
                  )}
                  fill={priceColor}
                  isAnimationActive={false}
                />
              ) : null}
              {showPrev ? (
                <ReferenceLine
                  yAxisId="price"
                  y={previousClose}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="6 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: "PREV",
                    position: "insideTopLeft",
                    fill: "var(--muted-foreground)",
                    fontSize: 10,
                  }}
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
                  }) => (
                    <PriceTag viewBox={props.viewBox} value={active.close} />
                  )}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {panes.map((pane) => {
          const info = studyInfo.get(pane.key);
          return (
            <div
              key={pane.key}
              className="study-pane"
              data-last={pane.key === lastPane || undefined}
            >
              <div className="study-legend">
                <strong>{info?.short}</strong>
                {pane.lines.map((line) => {
                  const value = numberAt(active, line.key);
                  return (
                    <span key={line.key} style={{ color: line.color }}>
                      {line.label}{" "}
                      {value == null
                        ? "—"
                        : pane.key === "obv" || pane.key === "volume"
                          ? compact(value)
                          : amount(value)}
                    </span>
                  );
                })}
                {pane.key === "volume" && bar?.volume != null ? (
                  <span>{compact(bar.volume)}</span>
                ) : null}
              </div>
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <ComposedChart
                  data={values}
                  syncId={sync}
                  margin={margin}
                  onMouseMove={onMove}
                  onMouseLeave={() => setHover(null)}
                >
                  <CartesianGrid vertical={false} stroke="var(--rule)" />
                  {xAxis(pane.key === lastPane)}
                  <YAxis
                    orientation="right"
                    width={66}
                    domain={pane.domain ?? ["auto", "auto"]}
                    tickFormatter={
                      pane.key === "volume" || pane.key === "obv"
                        ? compact
                        : axisStudy
                    }
                    tickCount={3}
                    tickMargin={8}
                    axisLine={false}
                    tickLine={false}
                    tick={axisTick}
                  />
                  <Tooltip
                    content={() => null}
                    cursor={{
                      stroke: "var(--muted-foreground)",
                      strokeWidth: 1,
                    }}
                    isAnimationActive={false}
                  />
                  {pane.levels?.map((level) => (
                    <ReferenceLine
                      key={level}
                      y={level}
                      stroke="var(--strong-border)"
                      strokeDasharray="3 3"
                    />
                  ))}
                  {pane.histogram ? (
                    <Bar
                      dataKey={pane.histogram}
                      shape={signedBar(pane.histogram)}
                      isAnimationActive={false}
                    />
                  ) : null}
                  {pane.lines.map((line) => (
                    <Line
                      key={line.key}
                      dataKey={line.key}
                      stroke={line.color}
                      strokeWidth={1.2}
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </div>
    </>
  );
}
