import type { MacrosWeightTrendPoint } from "@repo/schemas/macros";
import { useMemo } from "react";
import Svg, {
  Circle,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import {
  formatDecimal,
  formatInteger,
  type WeightUnit,
  weightValue,
} from "@/lib/format";
import { macroColors, useResolvedColors } from "@/ui";
import {
  bandPath,
  clamp,
  linePath,
  type PlotPoint,
  paddedDomain,
} from "./chart-kit";
import { type ChartScales, TimeChart } from "./time-chart";

const FALLBACK_DOMAIN: [number, number] = [0, 1];

interface Selectable {
  selectedDate?: string | null;
  onSelectDate?: (date: string | null) => void;
}

function bandEdges(
  scales: ChartScales,
  rows: ReadonlyArray<{ date: string; low: number; high: number }>,
) {
  const bound = (value: number) =>
    clamp(scales.y(value), scales.plotTop, scales.plotBottom);
  return bandPath(
    rows.map((row) => ({ x: scales.x(row.date), y: bound(row.high) })),
    rows.map((row) => ({ x: scales.x(row.date), y: bound(row.low) })),
  );
}

export interface WeightTrendChartProps extends Selectable {
  points: readonly MacrosWeightTrendPoint[];
  goalKg: number | null;
  unit: WeightUnit;
  height?: number;
}

/**
 * Trend weight as the line, scale readings as quiet dots, the 95% band
 * behind them and the goal as a dashed rule — only when the goal is close
 * enough that drawing it would not flatten the trend into a straight line.
 */
export function WeightTrendChart({
  points,
  goalKg,
  unit,
  height = 220,
  selectedDate,
  onSelectDate,
}: WeightTrendChartProps) {
  const resolved = useResolvedColors();
  const rows = useMemo(
    () =>
      points.map((point) => {
        const sigma = 1.96 * Math.sqrt(Math.max(0, point.varianceKg2));
        return {
          date: point.date,
          trend: weightValue(point.trendWeightKg, unit),
          scale:
            point.scaleWeightKg == null
              ? null
              : weightValue(point.scaleWeightKg, unit),
          low: weightValue(point.trendWeightKg - sigma, unit),
          high: weightValue(point.trendWeightKg + sigma, unit),
          hasBand: sigma > 0,
        };
      }),
    [points, unit],
  );
  const goal = goalKg == null ? null : weightValue(goalKg, unit);
  const minSpan = unit === "lb" ? 2 : 1;

  const { domain, goalVisible } = useMemo(() => {
    const values = rows.flatMap((row) =>
      row.scale == null ? [row.trend] : [row.trend, row.scale],
    );
    const base = paddedDomain(values, { minSpan }) ?? FALLBACK_DOMAIN;
    if (goal == null) return { domain: base, goalVisible: false };
    const reach = (base[1] - base[0]) * 0.6;
    if (goal < base[0] - reach || goal > base[1] + reach) {
      return { domain: base, goalVisible: false };
    }
    return {
      domain: paddedDomain([...values, goal], { minSpan }) ?? base,
      goalVisible: true,
    };
  }, [rows, goal, minSpan]);

  const dates = useMemo(() => rows.map((row) => row.date), [rows]);
  const selected = rows.find((row) => row.date === selectedDate);
  const first = rows.at(0);
  const last = rows.at(-1);
  const dotRadius = rows.length > 120 ? 1.6 : 2.4;

  return (
    <TimeChart
      dates={dates}
      domain={domain}
      height={height}
      formatTick={(value) => formatDecimal(value)}
      selectedDate={selectedDate}
      onSelectDate={onSelectDate}
      accessibilityLabel={
        first && last
          ? `Trend weight chart, ${formatDecimal(first.trend)} to ${formatDecimal(last.trend)} ${unit}`
          : "Trend weight chart"
      }
    >
      {(scales) => {
        const trendPoints: PlotPoint[] = rows.map((row) => ({
          x: scales.x(row.date),
          y: scales.y(row.trend),
        }));
        const banded = rows.filter((row) => row.hasBand);
        const goalY = goal != null && goalVisible ? scales.y(goal) : null;
        return (
          <>
            {banded.length > 1 ? (
              <Path
                d={bandEdges(scales, banded)}
                fill={resolved.label}
                fillOpacity={0.07}
              />
            ) : null}
            {goalY != null ? (
              <>
                <Line
                  x1={scales.plotLeft}
                  x2={scales.plotRight}
                  y1={goalY}
                  y2={goalY}
                  stroke={resolved.secondaryLabel}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                <SvgText
                  x={scales.plotLeft + 2}
                  y={goalY - 5}
                  fontSize={11}
                  fill={resolved.secondaryLabel}
                >
                  Goal
                </SvgText>
              </>
            ) : null}
            {rows.map((row) =>
              row.scale == null ? null : (
                <Circle
                  key={row.date}
                  cx={scales.x(row.date)}
                  cy={scales.y(row.scale)}
                  r={dotRadius}
                  fill={resolved.tertiaryLabel}
                />
              ),
            )}
            <Path
              d={linePath(trendPoints)}
              stroke={resolved.label}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
            {selected ? (
              <>
                {selected.scale != null ? (
                  <Circle
                    cx={scales.x(selected.date)}
                    cy={scales.y(selected.scale)}
                    r={3.5}
                    fill={resolved.secondaryLabel}
                  />
                ) : null}
                <Circle
                  cx={scales.x(selected.date)}
                  cy={scales.y(selected.trend)}
                  r={4.5}
                  fill={resolved.label}
                  stroke={resolved.background}
                  strokeWidth={2}
                />
              </>
            ) : null}
          </>
        );
      }}
    </TimeChart>
  );
}

export interface ExpenditurePoint {
  date: string;
  tdee: number | null;
  low: number | null;
  high: number | null;
  /** Logged intake; 0 or null draws no bar. */
  intake?: number | null;
}

export interface ExpenditureChartProps extends Selectable {
  points: readonly ExpenditurePoint[];
  /** Converts kcal into the display unit. */
  toUnit: (kcal: number) => number;
  height?: number;
  compact?: boolean;
}

/** Expenditure with its 95% band; logged intake as thin bars underneath when given. */
export function ExpenditureChart({
  points,
  toUnit,
  height = 200,
  compact = false,
  selectedDate,
  onSelectDate,
}: ExpenditureChartProps) {
  const resolved = useResolvedColors();
  const dates = useMemo(() => points.map((point) => point.date), [points]);
  const domain = useMemo(() => {
    const values = points.flatMap((point) => [
      ...(point.tdee != null ? [toUnit(point.tdee)] : []),
      ...(point.intake ? [toUnit(point.intake)] : []),
    ]);
    const bounds =
      paddedDomain(values, { minSpan: toUnit(200), padding: 0.1 }) ??
      FALLBACK_DOMAIN;
    const hasBars = points.some((point) => point.intake);
    // Bars need a baseline the eye can compare against, so the axis starts
    // lower than the line alone would need.
    return hasBars
      ? ([
          Math.max(0, bounds[0] - (bounds[1] - bounds[0]) * 0.6),
          bounds[1],
        ] as const)
      : bounds;
  }, [points, toUnit]);
  const selected = points.find((point) => point.date === selectedDate);
  const latest = [...points].reverse().find((point) => point.tdee != null);

  return (
    <TimeChart
      dates={dates}
      domain={domain}
      height={height}
      formatTick={compact ? undefined : (value) => formatInteger(value)}
      showDateAxis={!compact}
      selectedDate={selectedDate}
      onSelectDate={onSelectDate}
      accessibilityLabel={
        latest?.tdee != null
          ? `Expenditure chart, latest ${formatInteger(toUnit(latest.tdee))}`
          : "Expenditure chart"
      }
    >
      {(scales) => {
        const withTdee = points.flatMap((point) =>
          point.tdee != null
            ? [
                {
                  date: point.date,
                  tdee: toUnit(point.tdee),
                  low: toUnit(point.low ?? point.tdee),
                  high: toUnit(point.high ?? point.tdee),
                },
              ]
            : [],
        );
        const spacing =
          points.length > 1
            ? (scales.plotRight - scales.plotLeft) / points.length
            : scales.plotRight - scales.plotLeft;
        const barWidth = clamp(spacing * 0.55, 1, 8);
        return (
          <>
            {points.map((point) =>
              point.intake ? (
                <Rect
                  key={point.date}
                  x={scales.x(point.date) - barWidth / 2}
                  y={scales.y(toUnit(point.intake))}
                  width={barWidth}
                  height={Math.max(
                    0,
                    scales.plotBottom - scales.y(toUnit(point.intake)),
                  )}
                  rx={Math.min(2, barWidth / 2)}
                  fill={macroColors.calories}
                  fillOpacity={point.date === selectedDate ? 0.9 : 0.45}
                />
              ) : null,
            )}
            {withTdee.length > 1 ? (
              <Path
                d={bandEdges(scales, withTdee)}
                fill={resolved.label}
                fillOpacity={0.08}
              />
            ) : null}
            <Path
              d={linePath(
                points.map((point) =>
                  point.tdee == null
                    ? null
                    : {
                        x: scales.x(point.date),
                        y: scales.y(toUnit(point.tdee)),
                      },
                ),
              )}
              stroke={resolved.label}
              strokeWidth={compact ? 1.5 : 2}
              strokeLinejoin="round"
              fill="none"
            />
            {selected?.tdee != null ? (
              <Circle
                cx={scales.x(selected.date)}
                cy={scales.y(toUnit(selected.tdee))}
                r={4.5}
                fill={resolved.label}
                stroke={resolved.background}
                strokeWidth={2}
              />
            ) : null}
          </>
        );
      }}
    </TimeChart>
  );
}

export interface LineSeries {
  key: string;
  label: string;
  /** Aligned with the chart's dates; `null` leaves a gap. */
  values: ReadonlyArray<number | null>;
  color: string;
  width?: number;
  dashed?: boolean;
}

export interface LinesChartProps extends Selectable {
  dates: readonly string[];
  series: readonly LineSeries[];
  formatTick: (value: number) => string;
  minSpan?: number;
  /** Draw a hairline at zero, for series that are changes rather than levels. */
  zeroLine?: boolean;
  height?: number;
  accessibilityLabel: string;
}

export function LinesChart({
  dates,
  series,
  formatTick,
  minSpan = 1,
  zeroLine = false,
  height = 180,
  selectedDate,
  onSelectDate,
  accessibilityLabel,
}: LinesChartProps) {
  const resolved = useResolvedColors();
  const domain = useMemo(() => {
    const values = series.flatMap((line) =>
      line.values.filter((value): value is number => value != null),
    );
    return (
      paddedDomain(zeroLine ? [...values, 0] : values, { minSpan }) ??
      FALLBACK_DOMAIN
    );
  }, [series, minSpan, zeroLine]);
  const selectedIndex = selectedDate ? dates.indexOf(selectedDate) : -1;

  return (
    <TimeChart
      dates={dates}
      domain={domain}
      height={height}
      formatTick={formatTick}
      selectedDate={selectedDate}
      onSelectDate={onSelectDate}
      accessibilityLabel={accessibilityLabel}
    >
      {(scales) => (
        <>
          {zeroLine ? (
            <Line
              x1={scales.plotLeft}
              x2={scales.plotRight}
              y1={scales.y(0)}
              y2={scales.y(0)}
              stroke={resolved.secondaryLabel}
              strokeWidth={1}
            />
          ) : null}
          {series.map((line) => (
            <Path
              key={line.key}
              d={linePath(
                line.values.map((value, index) => {
                  const date = dates[index];
                  return value == null || !date
                    ? null
                    : { x: scales.x(date), y: scales.y(value) };
                }),
              )}
              stroke={line.color}
              strokeWidth={line.width ?? 1.5}
              strokeDasharray={line.dashed ? "4 3" : undefined}
              strokeLinejoin="round"
              fill="none"
            />
          ))}
          {selectedIndex >= 0 && selectedDate
            ? series.map((line) => {
                const value = line.values[selectedIndex];
                return value == null ? null : (
                  <Circle
                    key={line.key}
                    cx={scales.x(selectedDate)}
                    cy={scales.y(value)}
                    r={3.5}
                    fill={line.color}
                    stroke={resolved.background}
                    strokeWidth={1.5}
                  />
                );
              })
            : null}
        </>
      )}
    </TimeChart>
  );
}

const SHARE_DOMAIN = [0, 100] as const;

export interface MacroShare {
  date: string;
  protein: number;
  carbs: number;
  fat: number;
}

/** Protein, carbs and fat as a share of macro calories per logged day, stacked to 100%. */
export function MacroShareChart({
  days,
  height = 160,
  selectedDate,
  onSelectDate,
}: { days: readonly MacroShare[]; height?: number } & Selectable) {
  const dates = useMemo(() => days.map((day) => day.date), [days]);
  return (
    <TimeChart
      dates={dates}
      domain={SHARE_DOMAIN}
      height={height}
      formatTick={(value) => `${formatInteger(value)}%`}
      selectedDate={selectedDate}
      onSelectDate={onSelectDate}
      accessibilityLabel="Macro distribution chart"
    >
      {(scales) => {
        const layers = [
          {
            key: "protein",
            color: macroColors.protein,
            top: (day: MacroShare) => day.protein,
          },
          {
            key: "carbs",
            color: macroColors.carbs,
            top: (day: MacroShare) => day.protein + day.carbs,
          },
          { key: "fat", color: macroColors.fat, top: () => 100 },
        ];
        let previous: (day: MacroShare) => number = () => 0;
        return (
          <>
            {layers.map((layer) => {
              const bottom = previous;
              previous = layer.top;
              return (
                <Path
                  key={layer.key}
                  d={bandPath(
                    days.map((day) => ({
                      x: scales.x(day.date),
                      y: scales.y(layer.top(day)),
                    })),
                    days.map((day) => ({
                      x: scales.x(day.date),
                      y: scales.y(bottom(day)),
                    })),
                  )}
                  fill={layer.color}
                  fillOpacity={0.75}
                />
              );
            })}
          </>
        );
      }}
    </TimeChart>
  );
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** Calories by hour of day as 24 thin columns. */
export function HourBars({
  hours,
  height = 90,
}: {
  /** Index 0–23 holds that local hour's calories. */
  hours: readonly number[];
  height?: number;
}) {
  const resolved = useResolvedColors();
  const max = Math.max(...hours, 1);
  const peak = hours.indexOf(max);
  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 240 ${height}`}
      preserveAspectRatio="none"
      accessibilityLabel={`Calories by hour, most at ${String(peak).padStart(2, "0")}:00`}
    >
      {HOURS.map((hour) => {
        const barHeight = ((hours[hour] ?? 0) / max) * (height - 2);
        return (
          <Rect
            key={hour}
            x={hour * 10 + 2}
            y={height - barHeight}
            width={6}
            height={barHeight}
            rx={1.5}
            fill={hour === peak ? resolved.label : resolved.secondaryLabel}
            fillOpacity={hour === peak ? 1 : 0.6}
          />
        );
      })}
    </Svg>
  );
}
