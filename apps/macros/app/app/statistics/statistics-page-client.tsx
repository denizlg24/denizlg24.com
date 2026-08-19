"use client";

import { Button } from "@repo/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@repo/ui/chart";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import type {
  StatisticsData,
  StatisticsPeriod,
} from "@/lib/statistics/service";
import { PageHeader } from "../_components/page-header";

const periods = [
  { value: "7d", label: "7d" },
  { value: "28d", label: "28d" },
  { value: "90d", label: "90d" },
  { value: "1y", label: "1y" },
  { value: "all", label: "All" },
] satisfies Array<{ value: StatisticsPeriod; label: string }>;

async function getStatistics(period: StatisticsPeriod) {
  const response = await fetch(`/api/statistics?period=${period}`);
  if (!response.ok) throw new Error("Could not load statistics");
  return ((await response.json()) as { statistics: StatisticsData }).statistics;
}

function displayNumber(value: number | null, digits = 0) {
  return value == null ? "—" : value.toFixed(digits);
}

export function StatisticsPageClient() {
  const [period, setPeriod] = useState<StatisticsPeriod>("28d");
  const [periodReady, setPeriodReady] = useState(false);
  const touchStartX = useRef<number | null>(null);
  useEffect(() => {
    const stored = window.localStorage.getItem("macros.statistics-period");
    if (periods.some((option) => option.value === stored))
      setPeriod(stored as StatisticsPeriod);
    setPeriodReady(true);
  }, []);
  useEffect(() => {
    if (periodReady)
      window.localStorage.setItem("macros.statistics-period", period);
  }, [period, periodReady]);
  const query = useQuery({
    queryKey: ["statistics", period],
    queryFn: () => getStatistics(period),
  });
  const chartData = useMemo(() => {
    const series = query.data?.series ?? [];
    const firstWeight =
      series.find((point) => point.trendWeightKg != null)?.trendWeightKg ??
      null;
    return series.map((point) => {
      const macroCalories = point.protein * 4 + point.carbs * 4 + point.fat * 9;
      return {
        ...point,
        label: point.date.slice(5),
        tdeeBand:
          point.tdeeLow != null && point.tdeeHigh != null
            ? [point.tdeeLow, point.tdeeHigh]
            : null,
        actualWeightChangeKg:
          firstWeight != null && point.trendWeightKg != null
            ? point.trendWeightKg - firstWeight
            : null,
        proteinPct: macroCalories
          ? (point.protein * 4 * 100) / macroCalories
          : 0,
        carbsPct: macroCalories ? (point.carbs * 4 * 100) / macroCalories : 0,
        fatPct: macroCalories ? (point.fat * 9 * 100) / macroCalories : 0,
      };
    });
  }, [query.data]);
  const data = query.data;

  return (
    <div
      className="min-h-dvh pb-36"
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const startX = touchStartX.current;
        const endX = event.changedTouches[0]?.clientX;
        touchStartX.current = null;
        if (startX == null || endX == null || Math.abs(endX - startX) < 60)
          return;
        const index = periods.findIndex((option) => option.value === period);
        const next = endX < startX ? index + 1 : index - 1;
        const nextPeriod = periods[next]?.value;
        if (nextPeriod) setPeriod(nextPeriod);
      }}
    >
      <PageHeader title="Statistics" backLabel="Back" />
      <div className="space-y-8 px-5 pt-5">
        <SegmentedControl
          ariaLabel="Statistics period"
          value={period}
          options={periods}
          onValueChange={setPeriod}
        />
        {query.isLoading ? (
          <div className="h-64 animate-pulse rounded-2xl bg-muted" />
        ) : null}
        {query.isError ? (
          <Button variant="outline" onClick={() => query.refetch()}>
            Try again
          </Button>
        ) : null}
        {data ? (
          <>
            <section>
              <h2 className="text-lg font-bold">Energy expenditure</h2>
              <p className="text-sm text-muted-foreground">
                Intake bars against measured TDEE and its 95% confidence band.
              </p>
              {chartData.length >= 3 ? (
                <ChartContainer
                  className="mt-3 h-72 w-full"
                  config={{
                    calories: { label: "Intake", color: "var(--chart-2)" },
                    tdee: { label: "TDEE", color: "var(--chart-1)" },
                    tdeeBand: {
                      label: "95% confidence",
                      color: "var(--chart-1)",
                    },
                  }}
                >
                  <ComposedChart data={chartData} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis hide domain={["dataMin - 200", "dataMax + 200"]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="tdeeBand"
                      stroke="none"
                      fill="var(--color-tdeeBand)"
                      fillOpacity={0.14}
                    />
                    <Bar
                      dataKey="calories"
                      fill="var(--color-calories)"
                      opacity={0.45}
                      radius={[3, 3, 0, 0]}
                    />
                    <Line
                      type="monotone"
                      dataKey="tdee"
                      stroke="var(--color-tdee)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  </ComposedChart>
                </ChartContainer>
              ) : (
                <p className="mt-3 rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
                  At least 3 fully logged days and several weigh-ins are needed.
                  Current: {data.denominator.loggedDays} logged days,{" "}
                  {data.denominator.weighIns} weigh-ins.
                </p>
              )}
            </section>

            <section>
              <h2 className="text-lg font-bold">Intake trend</h2>
              <p className="text-sm text-muted-foreground">
                Rolling averages only include logged days.
              </p>
              <ChartContainer
                className="mt-3 h-64 w-full"
                config={{
                  rolling7Calories: { label: "7-day", color: "var(--chart-1)" },
                  rolling14Calories: {
                    label: "14-day",
                    color: "var(--chart-2)",
                  },
                  rolling28Calories: {
                    label: "28-day",
                    color: "var(--chart-3)",
                  },
                }}
              >
                <ComposedChart data={chartData} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis hide />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    dataKey="rolling7Calories"
                    stroke="var(--color-rolling7Calories)"
                    dot={false}
                    connectNulls
                  />
                  <Line
                    dataKey="rolling14Calories"
                    stroke="var(--color-rolling14Calories)"
                    dot={false}
                    connectNulls
                  />
                  <Line
                    dataKey="rolling28Calories"
                    stroke="var(--color-rolling28Calories)"
                    dot={false}
                    connectNulls
                  />
                </ComposedChart>
              </ChartContainer>
            </section>

            <section>
              <h2 className="text-lg font-bold">Macro trend</h2>
              <p className="text-sm text-muted-foreground">
                Seven-day rolling grams; only days with logged nutrition are
                included.
              </p>
              <ChartContainer
                className="mt-3 h-64 w-full"
                config={{
                  rolling7Protein: {
                    label: "Protein",
                    color: "var(--chart-1)",
                  },
                  rolling7Carbs: {
                    label: "Carbs",
                    color: "var(--chart-2)",
                  },
                  rolling7Fat: { label: "Fat", color: "var(--chart-3)" },
                }}
              >
                <ComposedChart data={chartData} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    dataKey="rolling7Protein"
                    stroke="var(--color-rolling7Protein)"
                    dot={false}
                    connectNulls
                  />
                  <Line
                    dataKey="rolling7Carbs"
                    stroke="var(--color-rolling7Carbs)"
                    dot={false}
                    connectNulls
                  />
                  <Line
                    dataKey="rolling7Fat"
                    stroke="var(--color-rolling7Fat)"
                    dot={false}
                    connectNulls
                  />
                </ComposedChart>
              </ChartContainer>
            </section>

            <section>
              <h2 className="text-lg font-bold">Model vs reality</h2>
              <p className="text-sm text-muted-foreground">
                Predicted weight change from cumulative energy balance against
                actual trend change.
              </p>
              <ChartContainer
                className="mt-3 h-64 w-full"
                config={{
                  predictedWeightChangeKg: {
                    label: "Predicted",
                    color: "var(--chart-2)",
                  },
                  actualWeightChangeKg: {
                    label: "Actual trend",
                    color: "var(--chart-1)",
                  },
                }}
              >
                <ComposedChart data={chartData} accessibilityLayer>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis hide />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    dataKey="predictedWeightChangeKg"
                    stroke="var(--color-predictedWeightChangeKg)"
                    dot={false}
                    connectNulls
                  />
                  <Line
                    dataKey="actualWeightChangeKg"
                    stroke="var(--color-actualWeightChangeKg)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </ComposedChart>
              </ChartContainer>
            </section>

            <section>
              <h2 className="text-lg font-bold">Macro distribution</h2>
              <ChartContainer
                className="mt-3 h-56 w-full"
                config={{
                  proteinPct: { label: "Protein", color: "var(--chart-1)" },
                  carbsPct: { label: "Carbs", color: "var(--chart-2)" },
                  fatPct: { label: "Fat", color: "var(--chart-3)" },
                }}
              >
                <ComposedChart
                  data={chartData}
                  stackOffset="expand"
                  accessibilityLayer
                >
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis hide domain={[0, 100]} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    stackId="macros"
                    dataKey="proteinPct"
                    stroke="none"
                    fill="var(--color-proteinPct)"
                  />
                  <Area
                    stackId="macros"
                    dataKey="carbsPct"
                    stroke="none"
                    fill="var(--color-carbsPct)"
                  />
                  <Area
                    stackId="macros"
                    dataKey="fatPct"
                    stroke="none"
                    fill="var(--color-fatPct)"
                  />
                </ComposedChart>
              </ChartContainer>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <Stat
                label="Mean intake"
                value={`${displayNumber(data.summary.averageCalories)} kcal`}
                note={`${data.denominator.loggedDays} of ${data.denominator.calendarDays} days logged · ${data.denominator.fullyLoggedDays} full`}
              />
              <Stat
                label="Measured TDEE"
                value={`${displayNumber(data.summary.latestTdee)} kcal`}
                note={
                  data.summary.tdeeVsPriorPercent == null
                    ? "latest estimate · formula comparison needs profile data"
                    : `${data.summary.tdeeVsPriorPercent >= 0 ? "+" : ""}${displayNumber(data.summary.tdeeVsPriorPercent, 1)}% vs ${displayNumber(data.summary.priorTdee)} kcal formula prior`
                }
              />
              <Stat
                label="Weight change"
                value={`${displayNumber(data.summary.weightChangeKg, 1)} kg`}
                note={
                  data.summary.projection
                    ? `${displayNumber(data.summary.rateKgPerWeek, 2)} kg/week (${displayNumber(data.summary.ratePercentBodyWeightPerWeek, 2)}%) · goal ${data.summary.projection.date} ±${data.summary.projection.uncertaintyWeeks}w`
                    : `${displayNumber(data.summary.rateKgPerWeek, 2)} kg/week (${displayNumber(data.summary.ratePercentBodyWeightPerWeek, 2)}%) · projection needs ≥14 days`
                }
              />
              <Stat
                label="Consistency"
                value={`${displayNumber(data.summary.intakeStandardDeviation)} kcal`}
                note="daily standard deviation"
              />
              <Stat
                label="Target distance"
                value={`${displayNumber(data.summary.averageAbsoluteTargetDistance)} kcal`}
                note="mean absolute daily difference"
              />
              <Stat
                label="Longest streak"
                value={`${data.summary.longestLoggingStreak} days`}
                note="consecutive logged days"
              />
              <Stat
                label="Weekdays"
                value={`${displayNumber(data.summary.weekdayCalories)} kcal`}
                note="mean logged intake"
              />
              <Stat
                label="Weekends"
                value={`${displayNumber(data.summary.weekendCalories)} kcal`}
                note="mean logged intake"
              />
            </section>

            <section>
              <h2 className="mb-3 text-lg font-bold">Weekly review</h2>
              <div className="space-y-2">
                {data.weekly.map((week) => (
                  <div key={week.week} className="rounded-xl bg-muted/40 p-4">
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold">Week of {week.week}</span>
                      <span className="tabular-nums">
                        {week.calories.toFixed(0)} /{" "}
                        {week.plannedCalories.toFixed(0)} kcal
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Actual vs planned across {week.loggedDays} logged days ·{" "}
                      {week.fullDays} fully logged
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-bold">Meals & timing</h2>
              <div className="grid grid-cols-2 gap-2">
                {data.mealBreakdown.map((meal) => (
                  <Stat
                    key={meal.mealType}
                    label={meal.mealType}
                    value={`${meal.averageCalories.toFixed(0)} kcal`}
                    note={`${meal.entries} entries in period`}
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Nutrition coverage averaged{" "}
                {displayNumber(
                  data.series.length
                    ? (data.series.reduce(
                        (sum, point) => sum + point.micronutrientCoverage,
                        0,
                      ) /
                        data.series.length) *
                        100
                    : null,
                )}
                % across foods. Micronutrient averages use only the{" "}
                {data.nutrientAverages.length
                  ? "days with values"
                  : "available source data"}
                ; missing values are never treated as zero.
              </p>
              {data.timeOfDay.length ? (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-semibold">Time of day</p>
                  {data.timeOfDay.map((time) => (
                    <div
                      key={time.hour}
                      className="flex items-center gap-3 text-xs"
                    >
                      <span className="w-12 tabular-nums">
                        {String(time.hour).padStart(2, "0")}:00
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full bg-primary"
                          style={{
                            width: `${Math.min(100, (time.calories / Math.max(...data.timeOfDay.map((item) => item.calories), 1)) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="w-16 text-right tabular-nums">
                        {time.calories.toFixed(0)} kcal
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section>
              <h2 className="mb-3 text-lg font-bold">Persistent shortfalls</h2>
              {data.nutrientShortfalls.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {data.nutrientShortfalls.slice(0, 8).map((item) => (
                    <Stat
                      key={item.key}
                      label={item.key}
                      value={`${item.percent.toFixed(0)}%`}
                      note={`${item.daysWithData} days with source data`}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No persistent shortfall can be supported by at least 3 days of
                  source data in this period.
                </p>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-lg font-bold">Target history</h2>
              <div className="space-y-2">
                {data.targetHistory.length ? (
                  data.targetHistory.map((issue) => (
                    <div key={issue.id} className="rounded-xl bg-muted/40 p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">
                          {issue.calories?.toFixed(0) ?? "—"} kcal
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {issue.date}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {issue.reason.replaceAll("_", " ")}
                        {issue.deltaCalories
                          ? ` · ${issue.deltaCalories > 0 ? "+" : ""}${issue.deltaCalories.toFixed(0)} kcal`
                          : ""}{" "}
                        · {issue.status.replaceAll("_", " ")}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No target issues in this period.
                  </p>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-bold">Top foods</h2>
              <p className="mb-2 text-xs text-muted-foreground">By frequency</p>
              <ol className="space-y-2">
                {data.topFoods.map((food, index) => (
                  <li
                    key={food.name}
                    className="flex rounded-xl bg-muted/40 p-3 text-sm"
                  >
                    <span className="mr-3 text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="flex-1 font-medium">{food.name}</span>
                    <span className="text-muted-foreground">
                      {food.count} logs · {food.calories.toFixed(0)} kcal
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mb-2 mt-5 text-xs text-muted-foreground">
                By calorie contribution
              </p>
              <ol className="space-y-2">
                {data.topFoodsByCalories.map((food, index) => (
                  <li
                    key={food.name}
                    className="flex rounded-xl bg-muted/40 p-3 text-sm"
                  >
                    <span className="mr-3 text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="flex-1 font-medium">{food.name}</span>
                    <span className="text-muted-foreground">
                      {food.calories.toFixed(0)} kcal
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-bold">Goal history</h2>
              <div className="space-y-2">
                {data.goalHistory.map((goal) => (
                  <div
                    key={goal.id}
                    className="rounded-xl bg-muted/40 p-4 text-sm"
                  >
                    <div className="flex justify-between">
                      <span className="font-semibold capitalize">
                        {goal.goalType}
                      </span>
                      <span className="text-muted-foreground">
                        {goal.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {goal.startDate} · {displayNumber(goal.startWeightKg, 1)}{" "}
                      kg → target {displayNumber(goal.targetWeightKg, 1)} kg
                      {goal.endWeightKg == null
                        ? ""
                        : ` · ended ${displayNumber(goal.endWeightKg, 1)} kg${goal.achieved ? " · achieved" : ""}`}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold">Your data</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Exports contain daily nutrition, completeness, expenditure, and
                trend weight.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button asChild variant="outline">
                  <a
                    href={`/api/statistics/export?period=${period}&format=csv`}
                  >
                    Download CSV
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a
                    href={`/api/statistics/export?period=${period}&format=json`}
                  >
                    Download JSON
                  </a>
                </Button>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl bg-muted/40 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
