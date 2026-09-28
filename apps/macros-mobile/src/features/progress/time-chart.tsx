import { format, parseISO } from "date-fns";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Line } from "react-native-svg";
import { haptics } from "@/lib/haptics";
import { Text, useResolvedColors } from "@/ui";
import {
  isoDayNumber,
  linearScale,
  nearestIndex,
  niceTicks,
} from "./chart-kit";

export interface ChartScales {
  x: (isoDate: string) => number;
  y: (value: number) => number;
  plotTop: number;
  plotBottom: number;
  plotLeft: number;
  plotRight: number;
}

export interface TimeChartProps {
  /** Ascending `yyyy-MM-dd` dates; the first and last bound the x axis. */
  dates: readonly string[];
  domain: readonly [number, number];
  height?: number;
  /** Labels the right-hand value axis. Omit for a bare sparkline. */
  formatTick?: (value: number) => string;
  showDateAxis?: boolean;
  selectedDate?: string | null;
  /** Tap to pin a day, drag to scrub; `null` clears. Omit to make the chart static. */
  onSelectDate?: (date: string | null) => void;
  accessibilityLabel: string;
  children: (scales: ChartScales) => ReactNode;
}

const Y_AXIS_WIDTH = 40;
const DATE_AXIS_HEIGHT = 18;
const TOP_INSET = 6;
const PLOT_LEFT = 0;

function formatAxisDate(isoDate: string, spanDays: number): string {
  return format(parseISO(isoDate), spanDays > 370 ? "MMM yyyy" : "d MMM");
}

/**
 * The frame every progress chart shares: hairline gridlines, a right-hand
 * value axis, start and end dates, and tap-or-drag selection. The series
 * themselves are drawn by `children` with the scales it is handed.
 */
export function TimeChart({
  dates,
  domain,
  height = 200,
  formatTick,
  showDateAxis = true,
  selectedDate = null,
  onSelectDate,
  accessibilityLabel,
  children,
}: TimeChartProps) {
  const resolved = useResolvedColors();
  const [width, setWidth] = useState(0);
  const firstDate = dates.at(0);
  const lastDate = dates.at(-1);

  const plotLeft = PLOT_LEFT;
  const plotRight = Math.max(0, width - (formatTick ? Y_AXIS_WIDTH : 0));
  const plotTop = TOP_INSET;
  const plotBottom = height - (showDateAxis ? DATE_AXIS_HEIGHT : 0) - 2;

  const scales = useMemo<ChartScales>(() => {
    const start = firstDate ? isoDayNumber(firstDate) : 0;
    const end = lastDate ? isoDayNumber(lastDate) : 1;
    const xDay = linearScale(
      [start, end === start ? start + 1 : end],
      [PLOT_LEFT + 4, plotRight - 4],
    );
    return {
      x: (isoDate: string) => xDay(isoDayNumber(isoDate)),
      y: linearScale(domain, [plotBottom, TOP_INSET]),
      plotTop: TOP_INSET,
      plotBottom,
      plotLeft: PLOT_LEFT,
      plotRight,
    };
  }, [firstDate, lastDate, domain, plotRight, plotBottom]);

  const ticks = useMemo(
    () => (formatTick ? niceTicks(domain, 3) : []),
    [domain, formatTick],
  );
  const positions = useMemo(
    () => dates.map((date) => scales.x(date)),
    [dates, scales],
  );

  const selectionRef = useRef({ positions, dates, onSelectDate, selectedDate });
  selectionRef.current = { positions, dates, onSelectDate, selectedDate };
  const lastPicked = useRef<string | null>(null);

  const gesture = useMemo(() => {
    const pick = (px: number, toggle: boolean) => {
      const current = selectionRef.current;
      const index = nearestIndex(current.positions, px);
      const date = current.dates[index];
      if (!date || !current.onSelectDate) return;
      if (toggle && date === current.selectedDate) {
        lastPicked.current = null;
        current.onSelectDate(null);
        return;
      }
      if (date !== lastPicked.current) haptics.selection();
      lastPicked.current = date;
      current.onSelectDate(date);
    };
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-4, 4])
      .failOffsetY([-12, 12])
      .onStart((event) => pick(event.x, false))
      .onUpdate((event) => pick(event.x, false))
      .onFinalize((_event, success) => {
        if (!success) return;
        lastPicked.current = null;
        selectionRef.current.onSelectDate?.(null);
      });
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((event, success) => {
        if (success) pick(event.x, true);
      });
    return Gesture.Race(pan, tap);
  }, []);

  const spanDays =
    firstDate && lastDate
      ? isoDayNumber(lastDate) - isoDayNumber(firstDate)
      : 0;

  const onLayout = (event: LayoutChangeEvent) =>
    setWidth(Math.round(event.nativeEvent.layout.width));

  const frame = (
    <View
      onLayout={onLayout}
      style={{ height }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {width > 0 ? (
        <>
          <Svg width={width} height={height}>
            {ticks.map((tick) => (
              <Line
                key={tick}
                x1={plotLeft}
                x2={plotRight}
                y1={scales.y(tick)}
                y2={scales.y(tick)}
                stroke={resolved.separator}
                strokeWidth={StyleSheet.hairlineWidth}
              />
            ))}
            {showDateAxis ? (
              <Line
                x1={plotLeft}
                x2={plotRight}
                y1={plotBottom}
                y2={plotBottom}
                stroke={resolved.separator}
                strokeWidth={StyleSheet.hairlineWidth}
              />
            ) : null}
            {children(scales)}
            {selectedDate ? (
              <Line
                x1={scales.x(selectedDate)}
                x2={scales.x(selectedDate)}
                y1={plotTop}
                y2={plotBottom}
                stroke={resolved.secondaryLabel}
                strokeWidth={1}
              />
            ) : null}
          </Svg>
          {ticks.map((tick) =>
            formatTick ? (
              <Text
                key={tick}
                variant="caption2"
                tone="secondary"
                figure
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
                style={[
                  styles.tick,
                  { top: scales.y(tick) - 7, left: plotRight + 6 },
                ]}
              >
                {formatTick(tick)}
              </Text>
            ) : null,
          )}
          {showDateAxis && firstDate && lastDate ? (
            <View
              style={[
                styles.dateAxis,
                { top: plotBottom + 4, width: plotRight },
              ]}
            >
              <Text
                variant="caption2"
                tone="secondary"
                figure
                maxFontSizeMultiplier={1.3}
              >
                {formatAxisDate(firstDate, spanDays)}
              </Text>
              {lastDate !== firstDate ? (
                <Text
                  variant="caption2"
                  tone="secondary"
                  figure
                  maxFontSizeMultiplier={1.3}
                >
                  {formatAxisDate(lastDate, spanDays)}
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );

  if (!onSelectDate) return frame;
  return <GestureDetector gesture={gesture}>{frame}</GestureDetector>;
}

const styles = StyleSheet.create({
  tick: {
    position: "absolute",
    width: Y_AXIS_WIDTH - 6,
  },
  dateAxis: {
    position: "absolute",
    left: 0,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
