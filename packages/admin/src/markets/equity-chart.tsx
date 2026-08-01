"use client";

import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

export interface CurvePoint {
  date: string;
  value: number;
}

export interface CurveSeries {
  key: string;
  color: string;
  points: CurvePoint[];
}

export interface EquityChartProps {
  series: CurveSeries[];
  /**
   * Rebase every series to 0% at its first point. A portfolio worth 10k and a
   * benchmark trading at 500 share no axis otherwise, and the comparison the
   * chart exists for is the shape, not the absolute level.
   */
  normalize?: boolean;
  height?: number;
  /** Same contract as CandleChart: a change reframes, equality keeps the viewport. */
  fitKey?: string;
}

export function EquityChart({
  series,
  normalize = false,
  height = 260,
  fitKey = "",
}: EquityChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const lines = useRef(new Map<string, ISeriesApi<"Line">>());
  const fitted = useRef<string | null>(null);

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
        timeVisible: false,
        secondsVisible: false,
      },
      crosshair: { mode: 1 },
      localization: { locale: "en-GB" },
    });
    chart.current = instance;

    const resize = new ResizeObserver(([entry]) => {
      if (entry) instance.applyOptions({ width: entry.contentRect.width });
    });
    resize.observe(container.current);

    return () => {
      resize.disconnect();
      instance.remove();
      chart.current = null;
      lines.current.clear();
    };
  }, [height]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;

    const wanted = new Set(series.map((item) => item.key));
    for (const [key, line] of lines.current) {
      if (wanted.has(key)) continue;
      instance.removeSeries(line);
      lines.current.delete(key);
    }

    for (const item of series) {
      let line = lines.current.get(item.key);
      if (!line) {
        line = instance.addSeries(LineSeries, {
          color: item.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: normalize
            ? { type: "custom", formatter: (v: number) => `${v.toFixed(1)}%` }
            : { type: "price", precision: 2, minMove: 0.01 },
        });
        lines.current.set(item.key, line);
      } else {
        line.applyOptions({ color: item.color });
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
  }, [series, normalize]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance || series.length === 0) return;
    if (fitted.current === fitKey) return;
    fitted.current = fitKey;
    instance.timeScale().fitContent();
  }, [fitKey, series]);

  return <div ref={container} className="w-full" />;
}
