"use client";

import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  LineStyle,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

export interface CurvePoint {
  date: string;
  value: number;
}

export interface CurveSeries {
  key: string;
  color: string;
  points: CurvePoint[];
  /** Legend text; also what the crosshair tooltip names the series. */
  label?: string;
  dashed?: boolean;
  /** Draws the reference series heavier than the ones being compared to it. */
  emphasis?: boolean;
}

/** `price` renders currency, `percent` appends a % sign. */
export type CurveFormat = "price" | "percent";

export interface EquityChartProps {
  series: CurveSeries[];
  /**
   * Rebase every series to 0% at its first point. A portfolio worth 10k and a
   * benchmark trading at 500 share no axis otherwise, and the comparison the
   * chart exists for is the shape, not the absolute level.
   */
  normalize?: boolean;
  /**
   * How to print values. Independent of `normalize`: an attribution series is
   * already denominated in percent and must not be rebased again.
   */
  format?: CurveFormat;
  /** Marks zero on the price scale — the sign is the story on a PnL axis. */
  baseline?: boolean;
  /**
   * Print clock time on the axis. A daily curve wants dates; an intraday one is
   * entirely within a day, and without this every label reads the same.
   */
  timeVisible?: boolean;
  height?: number;
  /** Same contract as CandleChart: a change reframes, equality keeps the viewport. */
  fitKey?: string;
}

interface HoverRow {
  key: string;
  label: string;
  color: string;
  value: number;
}

export function EquityChart({
  series,
  normalize = false,
  format = "price",
  baseline = false,
  timeVisible = false,
  height = 260,
  fitKey = "",
}: EquityChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const lines = useRef(new Map<string, ISeriesApi<"Line">>());
  const fitted = useRef<string | null>(null);
  // Read inside the crosshair handler, which lightweight-charts binds once.
  const meta = useRef(series);
  meta.current = series;

  const [hover, setHover] = useState<{ date: string; rows: HoverRow[] } | null>(
    null,
  );

  useEffect(() => {
    if (!container.current) return;
    fitted.current = null;

    const instance = createChart(container.current, {
      height,
      layout: {
        background: { color: "transparent" },
        textColor: "currentColor",
        attributionLogo: false,
      },
      grid: {
        horzLines: { color: "rgba(127,127,127,0.12)" },
        vertLines: { color: "rgba(127,127,127,0.06)" },
      },
      rightPriceScale: { borderColor: "rgba(127,127,127,0.2)" },
      timeScale: {
        borderColor: "rgba(127,127,127,0.2)",
        timeVisible,
        secondsVisible: false,
      },
      crosshair: { mode: 1 },
      localization: { locale: "en-GB" },
    });
    chart.current = instance;

    const onMove = (param: MouseEventParams) => {
      if (!param.time || !param.point) {
        setHover(null);
        return;
      }
      const rows: HoverRow[] = [];
      for (const item of meta.current) {
        const line = lines.current.get(item.key);
        if (!line) continue;
        const value = param.seriesData.get(line);
        if (!value || !("value" in value)) continue;
        rows.push({
          key: item.key,
          label: item.label ?? item.key,
          color: item.color,
          value: value.value as number,
        });
      }
      if (rows.length === 0) {
        setHover(null);
        return;
      }
      setHover({
        date: new Date((param.time as number) * 1000)
          .toISOString()
          .slice(0, 10),
        rows,
      });
    };

    instance.subscribeCrosshairMove(onMove);

    const resize = new ResizeObserver(([entry]) => {
      if (entry) instance.applyOptions({ width: entry.contentRect.width });
    });
    resize.observe(container.current);

    return () => {
      resize.disconnect();
      instance.unsubscribeCrosshairMove(onMove);
      instance.remove();
      chart.current = null;
      lines.current.clear();
    };
    // Height is applied to the live chart below. Rebuilding on a height change
    // would clear every line without re-running the series effect, leaving an
    // empty chart until the data itself changed.
  }, []);

  useEffect(() => {
    chart.current?.applyOptions({ height });
  }, [height]);

  // Same reason as height: applied to the live chart rather than rebuilding it,
  // which would drop every series.
  useEffect(() => {
    chart.current?.applyOptions({ timeScale: { timeVisible } });
  }, [timeVisible]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;

    const wanted = new Set(series.map((item) => item.key));
    for (const [key, line] of lines.current) {
      if (wanted.has(key)) continue;
      instance.removeSeries(line);
      lines.current.delete(key);
    }

    const priceFormat =
      format === "percent"
        ? ({
            type: "custom",
            formatter: (value: number) => `${value.toFixed(1)}%`,
          } as const)
        : ({ type: "price", precision: 2, minMove: 0.01 } as const);

    for (const item of series) {
      const style = {
        color: item.color,
        lineWidth: (item.emphasis ? 2 : 1.5) as 1 | 2,
        lineStyle: item.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      };

      let line = lines.current.get(item.key);
      if (!line) {
        line = instance.addSeries(LineSeries, style);
        lines.current.set(item.key, line);
      } else {
        line.applyOptions(style);
      }

      const base = item.points[0]?.value ?? 0;
      line.setData(
        item.points
          .map((point) => ({
            time: (Date.parse(point.date) / 1000) as UTCTimestamp,
            value:
              normalize && base !== 0
                ? ((point.value - base) / Math.abs(base)) * 100
                : point.value,
          }))
          .filter((point) => Number.isFinite(point.time)),
      );
    }
  }, [series, normalize, format]);

  // Hung off whichever series exists rather than its own, so the line lives and
  // dies with the data instead of holding the price scale open on an empty chart.
  useEffect(() => {
    const anchor = series[0] ? lines.current.get(series[0].key) : null;
    if (!anchor || !baseline) return;
    const line = anchor.createPriceLine({
      price: 0,
      color: "rgba(127,127,127,0.45)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false,
      title: "",
    });
    return () => {
      anchor.removePriceLine(line);
    };
  }, [baseline, series]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance || series.length === 0) return;
    if (fitted.current === fitKey) return;
    fitted.current = fitKey;
    instance.timeScale().fitContent();
  }, [fitKey, series]);

  return (
    <div className="relative">
      <div ref={container} className="w-full" />
      {hover ? (
        <div className="pointer-events-none absolute top-1 left-1 z-10 rounded border bg-background/95 px-2 py-1 text-[10px] shadow-sm backdrop-blur">
          <div className="mb-0.5 text-muted-foreground tabular-nums">
            {hover.date}
          </div>
          {hover.rows.map((row) => (
            <div key={row.key} className="flex items-center gap-1.5">
              <span
                className="inline-block size-1.5 shrink-0 rounded-full"
                style={{ background: row.color }}
              />
              <span className="text-muted-foreground">{row.label}</span>
              <span className="ml-auto pl-2 tabular-nums">
                {format === "percent"
                  ? `${row.value >= 0 ? "+" : ""}${row.value.toFixed(2)}%`
                  : row.value.toLocaleString("en-GB", {
                      maximumFractionDigits: 0,
                    })}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
