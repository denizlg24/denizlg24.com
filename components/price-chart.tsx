"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ZIndexLayer,
  DefaultZIndexes,
} from "recharts";
import {
  defaultAppearance,
  type ChartAppearance,
  type ChartPoint,
  type ChartScale,
  type ChartStyle,
  type CorporateEvent,
  customAverageSchema,
  customPaneSchema,
  type CustomAverage,
  type CustomPane,
  type Drawing,
} from "@/lib/models";
import {
  averageKey,
  averageLabel,
  computeAverages,
  computePanes,
  paneGuides,
  paneKey,
  paneLabel,
  rebaseOnto,
} from "@/lib/chart-studio";
import { DrawingLayer, type Tool } from "./chart/drawing-layer";
import { PromptDialog } from "./ui/prompt-dialog";
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
  tone,
}: {
  viewBox?: { x?: number; y?: number; width?: number };
  value: number;
  tone?: string;
}) {
  if (viewBox?.x == null || viewBox.y == null || viewBox.width == null)
    return null;
  const x = viewBox.x + viewBox.width + 2;
  return (
    <g className="price-tag">
      <rect
        x={x}
        y={viewBox.y - 9}
        width={62}
        height={18}
        rx={2}
        style={tone ? { fill: tone } : undefined}
      />
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
  key: string;
  label?: string;
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

/** Above every built-in recharts layer, so drawing clicks are never swallowed. */
const drawingZIndex = Math.max(...Object.values(DefaultZIndexes)) + 1;

export type CompareSeries = { symbol: string; points: ChartPoint[]; color: string };
const MIN_BARS = 12;

export default function PriceChart({
  points,
  lead = 0,
  range,
  style,
  studies = [],
  log = false,
  scale: scaleMode,
  averages = [],
  customPanes = [],
  appearance = defaultAppearance,
  compare = [],
  drawings = [],
  tool = "cursor",
  drawColor = "#e0a030",
  symbol = "",
  onAddDrawing,
  onRemoveDrawing,
  zoomable = false,
  events = [],
  alertLevels = [],
  onAlert,
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
  scale?: ChartScale;
  averages?: CustomAverage[];
  customPanes?: CustomPane[];
  appearance?: ChartAppearance;
  compare?: CompareSeries[];
  drawings?: Drawing[];
  tool?: Tool;
  drawColor?: string;
  symbol?: string;
  onAddDrawing?: (drawing: Drawing) => void;
  onRemoveDrawing?: (id: string) => void;
  zoomable?: boolean;
  events?: CorporateEvent[];
  alertLevels?: { target: number; direction: "above" | "below" }[];
  onAlert?: (price: number) => void;
  previousClose?: number | null;
  currency?: string;
  compact?: boolean;
}) {
  const gradient = useId().replaceAll(":", "");
  const sync = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ t: number; p: number }[] | null>(null);
  const scaleKind: ChartScale = scaleMode ?? (log ? "log" : "linear");
  const logScale = scaleKind === "log";
  const studyKey = studies.join(",");
  const averageSpec = JSON.stringify(averages);
  const paneSpec = JSON.stringify(customPanes);
  const all = useMemo(() => {
    const keys = studyKey ? (studyKey.split(",") as StudyKey[]) : [];
    const rows = computeStudies(points, keys);
    const custom = computeAverages(
      points,
      customAverageSchema.array().parse(JSON.parse(averageSpec)),
    );
    const oscillators = computePanes(
      points,
      customPaneSchema.array().parse(JSON.parse(paneSpec)),
    );
    const shown = style === "heikin" ? heikinAshi(points) : points;
    return shown.slice(lead).map((point, offset): Entry => {
      const i = offset + lead;
      const extra: Record<string, number | null> = {};
      custom.forEach((series, index) => {
        extra[averageKey(index)] = series[i];
      });
      oscillators.forEach((series, index) => {
        extra[paneKey(index)] = series[i];
      });
      return {
        ...point,
        ...rows[i],
        ...extra,
        span: [point.low, point.high],
        prior: i > 0 ? points[i - 1].close : null,
        actual: points[i],
      };
    });
  }, [points, lead, style, studyKey, averageSpec, paneSpec]);

  const [zoomWindow, setWindow] = useState<[number, number] | null>(null);
  const total = all.length;
  const [from, to] =
    zoomWindow && zoomWindow[1] <= total ? zoomWindow : [0, total];
  const zoomed = from > 0 || to < total;
  const base = useMemo(() => all.slice(from, to), [all, from, to]);
  const values = useMemo(() => {
    if (!compare.length || !base.length) return base;
    const anchor = base[0].close;
    const series = compare.map((item) => rebaseOnto(base, item.points, anchor));
    return base.map((entry, index) => {
      const extra: Record<string, number | null> = {};
      series.forEach((line, i) => {
        extra[`cmp${i}`] = line[index];
      });
      return { ...entry, ...extra } as Entry;
    });
  }, [base, compare]);

  const pane = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; from: number; to: number } | null>(null);
  useEffect(() => {
    const element = pane.current;
    if (!element || !zoomable) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width - 66)));
      setWindow((current) => {
        const [a, b] = current && current[1] <= total ? current : [0, total];
        const span = b - a;
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          const shift = Math.round((event.deltaX / rect.width) * span);
          const start = Math.min(total - span, Math.max(0, a + shift));
          return [start, start + span];
        }
        const next = Math.round(
          Math.min(total, Math.max(MIN_BARS, span * Math.exp(event.deltaY * 0.002))),
        );
        const anchor = a + span * fraction;
        let start = Math.round(anchor - next * fraction);
        start = Math.min(total - next, Math.max(0, start));
        return next >= total ? null : [start, start + next];
      });
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoomable, total]);

  const appearanceStyle = {
    ...(appearance.up ? { "--gain": appearance.up } : {}),
    ...(appearance.down ? { "--loss": appearance.down } : {}),
  } as CSSProperties;
  const percentBase = values[0]?.close ?? null;
  const axisValue = (value: number) =>
    scaleKind === "percent" && percentBase
      ? `${value >= percentBase ? "+" : ""}${((value / percentBase - 1) * 100).toFixed(Math.abs(value / percentBase - 1) < 0.1 ? 1 : 0)}%`
      : axisPrice(value);
  const extremes = useMemo(() => {
    if (!values.length) return null;
    let high = values[0];
    let low = values[0];
    for (const entry of values) {
      if (entry.actual.high > high.actual.high) high = entry;
      if (entry.actual.low < low.actual.low) low = entry;
    }
    return { high, low };
  }, [values]);
  const times = useMemo(() => values.map((entry) => entry.time), [values]);
  const markers = useMemo(() => {
    if (!appearance.events || small || !values.length) return [];
    return events.flatMap((event) => {
      const index = times.findIndex((time) => time >= event.time - 43200);
      if (index < 0 || Math.abs(times[index] - event.time) > 8 * 86400) return [];
      return [{ event, entry: values[index] }];
    });
  }, [appearance.events, small, events, times, values]);
  const visibleDrawings = drawings.filter((item) => item.symbol === symbol);
  const lineWidth = appearance.lineWidth;
  const priceStudies = studies.filter(
    (key) => studyInfo.get(key)?.pane === "price",
  );
  const panes: PaneSpec[] = small
    ? []
    : [
        ...studies.flatMap((key) => (paneSpecs[key] ? [paneSpecs[key]] : [])),
        ...customPanes.map(
          (pane, index): PaneSpec => ({
            key: paneKey(index),
            label: paneLabel(pane),
            ...paneGuides[pane.kind],
            lines: [{ key: paneKey(index), color: pane.color, label: "" }],
          }),
        ),
      ];
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
      {noteDraft && onAddDrawing ? (
        <PromptDialog
          title="Chart note"
          description="The note is pinned to this date and price."
          label="Text"
          placeholder="e.g. Breakout above resistance"
          maxLength={200}
          confirmLabel="Add note"
          onSubmit={(text) =>
            onAddDrawing({
              id: crypto.randomUUID(),
              symbol,
              kind: "text",
              points: noteDraft,
              color: drawColor,
              text,
            })
          }
          onClose={() => setNoteDraft(null)}
        />
      ) : null}
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
            {averages.map((average, index) => {
              const value = numberAt(active, averageKey(index));
              return value == null ? null : (
                <div
                  key={averageKey(index)}
                  className="readout-study"
                  style={{ color: average.color }}
                >
                  <dt>{averageLabel(average)}</dt>
                  <dd>{amount(value)}</dd>
                </div>
              );
            })}
            {compare.map((item, index) => {
              const value = numberAt(active, `cmp${index}`);
              const pct =
                value != null && percentBase
                  ? (value / percentBase - 1) * 100
                  : null;
              return (
                <div
                  key={item.symbol}
                  className="readout-study"
                  style={{ color: item.color }}
                  title={`${item.symbol} rebased to the first visible bar`}
                >
                  <dt>{item.symbol}</dt>
                  <dd>{percent(pct)}</dd>
                </div>
              );
            })}
            {zoomed ? (
              <div className="readout-zoom">
                <button type="button" onClick={() => setWindow(null)}>
                  Reset zoom · {to - from} bars
                </button>
              </div>
            ) : null}
            {currency ? <div className="readout-unit">{currency}</div> : null}
          </>
        ) : null}
      </dl>
      <div
        className="price-chart-stack"
        data-panes={panes.length}
        data-tool={tool}
        style={appearanceStyle}
        aria-label={`${range} price chart`}
      >
        <div
          className="price-pane"
          ref={pane}
          onDoubleClick={() => tool === "cursor" && setWindow(null)}
          onPointerDown={(event) => {
            if (!zoomable || tool !== "cursor" || event.button !== 0) return;
            pan.current = { x: event.clientX, from, to };
          }}
          onPointerMove={(event) => {
            const start = pan.current;
            if (!start || !(event.buttons & 1)) return;
            const span = start.to - start.from;
            if (span >= total) return;
            const width = event.currentTarget.getBoundingClientRect().width - 66;
            const shift = Math.round(((start.x - event.clientX) / width) * span);
            const next = Math.min(total - span, Math.max(0, start.from + shift));
            if (next !== from) setWindow([next, next + span]);
          }}
          onPointerUp={() => (pan.current = null)}
        >
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
              {appearance.grid ? (
                <CartesianGrid vertical={false} stroke="var(--rule)" />
              ) : null}
              {xAxis(!lastPane)}
              <YAxis
                yAxisId="price"
                orientation="right"
                width={66}
                scale={logScale ? "log" : "auto"}
                tickFormatter={axisValue}
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
                cursor={
                  appearance.crosshair
                    ? { stroke: "var(--muted-foreground)", strokeWidth: 1 }
                    : false
                }
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
              {averages.map((average, index) =>
                overlayLine(averageKey(index), average.color, { width: 1.3 }),
              )}
              {compare.map((item, index) =>
                overlayLine(`cmp${index}`, item.color, { width: 1.4, dash: "5 2" }),
              )}
              {style === "area" ? (
                <Area
                  yAxisId="price"
                  type="linear"
                  dataKey="close"
                  stroke={priceColor}
                  strokeWidth={lineWidth}
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
                  strokeWidth={lineWidth}
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
                    logScale,
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
              {appearance.lastPrice && !small && values.length ? (
                <ReferenceLine
                  yAxisId="price"
                  y={values.at(-1)!.close}
                  stroke={priceColor}
                  strokeOpacity={0.55}
                  strokeDasharray="1 3"
                  ifOverflow="hidden"
                  label={(props: {
                    viewBox?: { x?: number; y?: number; width?: number };
                  }) => (
                    <PriceTag
                      viewBox={props.viewBox}
                      value={values.at(-1)!.close}
                      tone={priceColor}
                    />
                  )}
                />
              ) : null}
              {appearance.extremes && extremes && !small ? (
                <>
                  <ReferenceDot
                    yAxisId="price"
                    x={extremes.high.time}
                    y={extremes.high.actual.high}
                    r={0}
                    label={{
                      value: `H ${amount(extremes.high.actual.high)}`,
                      position: "top",
                      fill: "var(--gain)",
                      fontSize: 10,
                    }}
                  />
                  <ReferenceDot
                    yAxisId="price"
                    x={extremes.low.time}
                    y={extremes.low.actual.low}
                    r={0}
                    label={{
                      value: `L ${amount(extremes.low.actual.low)}`,
                      position: "bottom",
                      fill: "var(--loss)",
                      fontSize: 10,
                    }}
                  />
                </>
              ) : null}
              {markers.map(({ event, entry }) => (
                <ReferenceDot
                  key={`${event.kind}-${event.time}`}
                  yAxisId="price"
                  x={entry.time}
                  y={entry.actual.low}
                  r={0}
                  ifOverflow="extendDomain"
                  shape={(props: { cx?: number; cy?: number }) =>
                    props.cx == null || props.cy == null ? (
                      <g />
                    ) : (
                      <g className="event-marker" data-kind={event.kind}>
                        <circle cx={props.cx} cy={props.cy + 12} r={6} />
                        <text x={props.cx} y={props.cy + 15.5} textAnchor="middle">
                          {event.kind === "dividend" ? "D" : "S"}
                        </text>
                        <title>
                          {event.kind === "dividend"
                            ? `Dividend ${amount(event.amount)} · ex-date ${new Date(event.time * 1000).toISOString().slice(0, 10)}`
                            : `Split ${event.ratio} · ${new Date(event.time * 1000).toISOString().slice(0, 10)}`}
                        </title>
                      </g>
                    )
                  }
                />
              ))}
              {appearance.alerts && !small
                ? alertLevels.map((alert) => (
                    <ReferenceLine
                      key={`${alert.direction}-${alert.target}`}
                      yAxisId="price"
                      y={alert.target}
                      stroke="var(--term-key)"
                      strokeDasharray="6 3"
                      ifOverflow="hidden"
                      label={{
                        value: `ALERT ${alert.direction === "above" ? "≥" : "≤"} ${amount(alert.target)}`,
                        position: "insideBottomLeft",
                        fill: "var(--term-key)",
                        fontSize: 10,
                      }}
                    />
                  ))
                : null}
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
              {onAddDrawing && onRemoveDrawing && !small ? (
                <ZIndexLayer zIndex={drawingZIndex}>
                <DrawingLayer
                  times={times}
                  drawings={visibleDrawings}
                  tool={tool}
                  color={drawColor}
                  symbol={symbol}
                  onAdd={onAddDrawing}
                  onRemove={onRemoveDrawing}
                  onAlert={onAlert}
                  onNote={setNoteDraft}
                />
                </ZIndexLayer>
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {panes.map((pane) => {
          const info = pane.label
            ? { short: pane.label }
            : studyInfo.get(pane.key as StudyKey);
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
                  {appearance.grid ? (
                <CartesianGrid vertical={false} stroke="var(--rule)" />
              ) : null}
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
                    cursor={
                      appearance.crosshair
                        ? { stroke: "var(--muted-foreground)", strokeWidth: 1 }
                        : false
                    }
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
