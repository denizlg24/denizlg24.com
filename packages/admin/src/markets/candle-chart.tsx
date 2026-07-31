"use client";

import type { Bar } from "@repo/markets/schemas";
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

export type ChartKind = "candles" | "area";

export interface Overlay {
  key: string;
  color: string;
  /** Aligned to `bars`; nulls are the indicator's warm-up window. */
  values: (number | null)[];
}

export interface CandleChartProps {
  bars: Bar[];
  kind?: ChartKind;
  overlays?: Overlay[];
  showVolume?: boolean;
  height?: number;
  /**
   * Identifies the dataset on screen — ticker, range, series type. A change
   * means the chart is showing something new and should frame all of it; the
   * same value across a refresh means the user is still looking at the same
   * thing and their pan and zoom must survive.
   */
  fitKey?: string;
}

/**
 * lightweight-charts owns its own canvas and mutates imperatively, so React
 * only ever creates it once and pushes data in. Re-creating the chart on every
 * data change would drop the user's pan and zoom on each poll.
 */
export function CandleChart({
  bars,
  kind = "candles",
  overlays = [],
  showVolume = true,
  height = 420,
  fitKey = "",
}: CandleChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick" | "Area"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lines = useRef(new Map<string, ISeriesApi<"Line">>());
  const fitted = useRef<string | null>(null);

  useEffect(() => {
    if (!container.current) return;
    // A rebuilt chart has the library's default viewport, so whatever was
    // framed before does not carry over.
    fitted.current = null;

    const instance = createChart(container.current, {
      height,
      layout: {
        background: { color: "transparent" },
        // Inherit the app's foreground so the chart tracks light and dark
        // without a second source of truth for the palette.
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
        timeVisible: true,
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
      price.current = null;
      volume.current = null;
      lines.current.clear();
    };
  }, [height]);

  // The series type is structural, so switching between candles and a line has
  // to tear the series down rather than re-style it.
  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;

    if (price.current) {
      instance.removeSeries(price.current);
      price.current = null;
    }

    price.current =
      kind === "candles"
        ? instance.addSeries(CandlestickSeries, {
            upColor: "#16a34a",
            downColor: "#dc2626",
            wickUpColor: "#16a34a",
            wickDownColor: "#dc2626",
            borderVisible: false,
          })
        : instance.addSeries(AreaSeries, {
            lineColor: "#2563eb",
            topColor: "rgba(37,99,235,0.28)",
            bottomColor: "rgba(37,99,235,0.02)",
            lineWidth: 2,
          });
  }, [kind]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;

    if (showVolume && !volume.current) {
      volume.current = instance.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      // Pinned to the bottom fifth so volume never fights the price series.
      instance
        .priceScale("volume")
        .applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    } else if (!showVolume && volume.current) {
      instance.removeSeries(volume.current);
      volume.current = null;
    }
  }, [showVolume]);

  useEffect(() => {
    if (!price.current || bars.length === 0) return;
    const times = bars.map((bar) => toTime(bar.ts));

    if (kind === "candles") {
      (price.current as ISeriesApi<"Candlestick">).setData(
        bars.map((bar, i) => ({
          time: times[i] as UTCTimestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        })),
      );
    } else {
      (price.current as ISeriesApi<"Area">).setData(
        bars.map((bar, i) => ({
          time: times[i] as UTCTimestamp,
          value: bar.close,
        })),
      );
    }

    volume.current?.setData(
      bars.map((bar, i) => ({
        time: times[i] as UTCTimestamp,
        value: bar.volume,
        color:
          bar.close >= bar.open
            ? "rgba(22,163,74,0.35)"
            : "rgba(220,38,38,0.35)",
      })),
    );
  }, [bars, kind]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;

    const wanted = new Set(overlays.map((overlay) => overlay.key));
    for (const [key, series] of lines.current) {
      if (wanted.has(key)) continue;
      instance.removeSeries(series);
      lines.current.delete(key);
    }

    for (const overlay of overlays) {
      let series = lines.current.get(overlay.key);
      if (!series) {
        series = instance.addSeries(LineSeries, {
          color: overlay.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        lines.current.set(overlay.key, series);
      }
      series.setData(
        overlay.values
          .map((value, i) => ({
            time: toTime(bars[i]?.ts ?? "") as UTCTimestamp,
            value,
          }))
          // Warm-up nulls are dropped rather than plotted as zero, which would
          // drag the price scale to the floor.
          .filter(
            (point): point is { time: UTCTimestamp; value: number } =>
              point.value !== null && Number.isFinite(point.time),
          ),
      );
    }
  }, [overlays, bars]);

  /**
   * Frame the whole dataset once it has landed. Declared last so it runs after
   * the effects that set the data — lightweight-charts otherwise opens on its
   * default bar spacing, which shows the tail of the range rather than the
   * range. Keyed rather than run on every change: `bars` is replaced on each
   * refresh, and re-fitting there would yank the viewport back while the user
   * is reading it.
   */
  useEffect(() => {
    const instance = chart.current;
    if (!instance || bars.length === 0) return;
    if (fitted.current === fitKey) return;
    fitted.current = fitKey;
    instance.timeScale().fitContent();
  }, [fitKey, bars]);

  return <div ref={container} className="w-full" />;
}

function toTime(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}
