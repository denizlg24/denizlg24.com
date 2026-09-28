import {
  isNutrientKey,
  nutrientDefinitionsInput,
} from "@repo/macros-core/foods/nutrients";
import {
  type MacrosStatistics,
  type MacrosStatisticsPeriod,
  macrosStatisticsPeriods,
} from "@repo/schemas/macros";
import { getTimezoneOffset } from "date-fns-tz";
import { Stack } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { type StatisticsExportFormat, useStatistics } from "@/api/statistics";
import { errorMessage } from "@/lib/api";
import {
  type EnergyUnit,
  energyLabel,
  energyValue,
  formatDecimal,
  formatInteger,
  formatWeightDelta,
  type WeightUnit,
  weightValue,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  EmptyState,
  InlineNotice,
  Meter,
  macroColors,
  Row,
  Section,
  Stat,
  spacing,
  Text,
  useResolvedColors,
  VStack,
} from "@/ui";
import { glyphs } from "@/ui/glyphs";
import {
  ExpenditureChart,
  HourBars,
  LinesChart,
  MacroShareChart,
} from "./charts";
import { Segmented } from "./controls";
import { exportStatistics } from "./export-statistics";
import {
  formatIsoDate,
  formatPercent,
  formatSignedEnergy,
  formatWeeklyRate,
  issueStatusLabel,
  planReasonLabel,
} from "./labels";
import { ScrollScreen } from "./scroll-screen";
import {
  averageSplit,
  calendarDays,
  caloriesByLocalHour,
  loggedDays,
  macroShares,
  modelVsReality,
} from "./statistics-view";
import { MacroTargets } from "./target-figures";
import { useRefresh } from "./use-refresh";
import { useStatisticsPeriod } from "./use-statistics-period";
import { useUnits } from "./use-units";

const PERIOD_LABELS: Record<MacrosStatisticsPeriod, string> = {
  "7d": "7D",
  "28d": "28D",
  "90d": "90D",
  "1y": "1Y",
  all: "All",
};

const PERIOD_OPTIONS = macrosStatisticsPeriods.map((period) => ({
  value: period,
  label: PERIOD_LABELS[period],
}));

const TOP_FOOD_OPTIONS = [
  { value: "count", label: "Most logged" },
  { value: "calories", label: "Most calories" },
] as const;

const nutrientNames = new Map(
  nutrientDefinitionsInput.map((definition) => [definition.key, definition]),
);

export function StatisticsScreen() {
  const { energyUnit, weightUnit, timezone, today } = useUnits();
  const [period, setPeriod] = useStatisticsPeriod();
  const statistics = useStatistics(period);
  const scrollRef = useRef<ScrollView>(null);
  const [exporting, setExporting] = useState<StatisticsExportFormat | null>(
    null,
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const { refreshing, onRefresh } = useRefresh([statistics.refetch]);

  const data = statistics.data;
  const showingOtherPeriod = data !== undefined && data.period !== period;

  const runExport = (format: StatisticsExportFormat) => {
    if (exporting) return;
    setExporting(format);
    setExportError(null);
    exportStatistics(period, format, today)
      .catch((cause: unknown) => {
        haptics.error();
        setExportError(`Export failed. ${errorMessage(cause)}`);
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      })
      .finally(() => setExporting(null));
  };

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu
          icon={glyphs.share}
          iconRenderingMode="template"
          accessibilityLabel="Export"
          disabled={exporting !== null}
          title={`Export ${PERIOD_LABELS[period]}`}
        >
          <Stack.Toolbar.MenuAction
            icon={glyphs["table-2"]}
            iconRenderingMode="template"
            onPress={() => runExport("csv")}
          >
            Spreadsheet (CSV)
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon={glyphs.braces}
            iconRenderingMode="template"
            onPress={() => runExport("json")}
          >
            Data (JSON)
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <ScrollScreen
        ref={scrollRef}
        onRefresh={onRefresh}
        refreshing={refreshing}
      >
        <VStack>
          <View style={styles.block}>
            <Segmented
              options={PERIOD_OPTIONS}
              value={period}
              onChange={setPeriod}
            />
            {exporting ? (
              <InlineNotice tone="info" message="Preparing your export…" />
            ) : null}
            {exportError ? (
              <InlineNotice
                message={exportError}
                onDismiss={() => setExportError(null)}
              />
            ) : null}
            {statistics.isError && !data ? (
              <InlineNotice
                message={errorMessage(statistics.error)}
                action={{ label: "Retry", onPress: onRefresh }}
              />
            ) : null}
            {data ? (
              <Text variant="footnote" tone="secondary" figure>
                {denominatorLine(data)}
                {showingOtherPeriod ? "  ·  updating…" : ""}
              </Text>
            ) : null}
          </View>

          {statistics.isPending ? (
            <ActivityIndicator style={styles.spinner} />
          ) : data &&
            data.denominator.loggedDays === 0 &&
            data.denominator.weighIns === 0 ? (
            <EmptyState
              icon="chart-column"
              title="Nothing in this period"
              message="Statistics fill in as you log food and weigh in."
            />
          ) : data ? (
            <StatisticsBody
              data={data}
              energyUnit={energyUnit}
              weightUnit={weightUnit}
              timezone={timezone}
            />
          ) : null}
        </VStack>
      </ScrollScreen>
    </>
  );
}

function denominatorLine(data: MacrosStatistics): string {
  const { loggedDays: logged, fullyLoggedDays, weighIns } = data.denominator;
  return `${logged} of ${calendarDays(data)} days logged · ${fullyLoggedDays} complete · ${weighIns} weigh-ins`;
}

function StatisticsBody({
  data,
  energyUnit,
  weightUnit,
  timezone,
}: {
  data: MacrosStatistics;
  energyUnit: EnergyUnit;
  weightUnit: WeightUnit;
  timezone: string;
}) {
  const toEnergy = (kcal: number) => energyValue(kcal, energyUnit);
  return (
    <>
      <ExpenditureSection
        data={data}
        energyUnit={energyUnit}
        toEnergy={toEnergy}
      />
      <IntakeSection data={data} energyUnit={energyUnit} toEnergy={toEnergy} />
      <MacroSplitSection data={data} />
      <WeightSection data={data} weightUnit={weightUnit} />
      <AdherenceSection
        data={data}
        energyUnit={energyUnit}
        toEnergy={toEnergy}
      />
      <TimeOfDaySection data={data} timezone={timezone} />
      <TopFoodsSection data={data} energyUnit={energyUnit} />
      <ShortfallsSection data={data} />
      <TargetHistorySection data={data} energyUnit={energyUnit} />
    </>
  );
}

/** One line above a chart: the tapped day's values, or what the chart shows. */
function Readout({ children }: { children: string }) {
  return (
    <Text variant="footnote" tone="secondary" figure numberOfLines={2}>
      {children}
    </Text>
  );
}

function ExpenditureSection({
  data,
  energyUnit,
  toEnergy,
}: {
  data: MacrosStatistics;
  energyUnit: EnergyUnit;
  toEnergy: (kcal: number) => number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const unit = energyLabel(energyUnit);
  const points = useMemo(
    () =>
      data.series.map((point) => ({
        date: point.date,
        tdee: point.tdee,
        low: point.tdeeLow,
        high: point.tdeeHigh,
        intake: point.calories > 0 ? point.calories : null,
      })),
    [data.series],
  );
  const measured = points.filter((point) => point.tdee != null).length;
  const { latestTdee, priorTdee, tdeeVsPriorPercent } = data.summary;
  const picked = points.find((point) => point.date === selected);

  return (
    <Section title="Expenditure">
      <View style={styles.block}>
        <View style={styles.figures}>
          <Stat
            label="Latest estimate"
            value={
              latestTdee == null ? "—" : formatInteger(toEnergy(latestTdee))
            }
            unit={latestTdee == null ? undefined : unit}
            size="large"
          />
          <Stat
            label="vs formula"
            value={
              tdeeVsPriorPercent == null
                ? "—"
                : `${tdeeVsPriorPercent > 0 ? "+" : ""}${formatPercent(tdeeVsPriorPercent, 1)}`
            }
            detail={
              priorTdee == null
                ? undefined
                : `${formatInteger(toEnergy(priorTdee))} ${unit}`
            }
            align="right"
          />
        </View>
        {measured >= 2 ? (
          <>
            <Readout>
              {picked
                ? `${formatIsoDate(picked.date)} · ate ${picked.intake ? formatInteger(toEnergy(picked.intake)) : "—"} · burned ${picked.tdee != null ? formatInteger(toEnergy(picked.tdee)) : "—"} ${unit}`
                : "Bars: what you ate. Line: estimated expenditure, with its 95% range."}
            </Readout>
            <ExpenditureChart
              points={points}
              toUnit={toEnergy}
              selectedDate={selected}
              onSelectDate={setSelected}
            />
          </>
        ) : (
          <Text variant="subheadline" tone="secondary">
            {`The estimate needs a few weeks of complete logging and regular weigh-ins. In this period: ${data.denominator.fullyLoggedDays} complete days, ${data.denominator.weighIns} weigh-ins.`}
          </Text>
        )}
      </View>
    </Section>
  );
}

function IntakeSection({
  data,
  energyUnit,
  toEnergy,
}: {
  data: MacrosStatistics;
  energyUnit: EnergyUnit;
  toEnergy: (kcal: number) => number;
}) {
  const resolved = useResolvedColors();
  const [selected, setSelected] = useState<string | null>(null);
  const unit = energyLabel(energyUnit);
  const summary = data.summary;
  const logged = loggedDays(data.series);
  const dates = useMemo(
    () => data.series.map((point) => point.date),
    [data.series],
  );
  const series = useMemo(
    () => [
      {
        key: "rolling7",
        label: "7-day",
        values: data.series.map((point) =>
          point.rolling7Calories == null
            ? null
            : toEnergy(point.rolling7Calories),
        ),
        color: resolved.label,
        width: 2,
      },
      {
        key: "rolling28",
        label: "28-day",
        values: data.series.map((point) =>
          point.rolling28Calories == null
            ? null
            : toEnergy(point.rolling28Calories),
        ),
        color: resolved.secondaryLabel,
        dashed: true,
      },
    ],
    [data.series, resolved, toEnergy],
  );
  const index = selected ? dates.indexOf(selected) : -1;
  const picked = index >= 0 ? data.series[index] : undefined;
  const value = (kcal: number | null | undefined) =>
    kcal == null ? "—" : formatInteger(toEnergy(kcal));

  return (
    <Section title="Intake">
      <View style={styles.block}>
        <View style={styles.figures}>
          <Stat
            label="Daily average"
            value={value(summary.averageCalories)}
            unit={summary.averageCalories == null ? undefined : unit}
            size="large"
            detail={`over ${logged.length} logged days`}
          />
          <Stat
            label="Day to day"
            value={
              summary.intakeStandardDeviation == null
                ? "—"
                : `± ${value(summary.intakeStandardDeviation)}`
            }
            detail="typical swing"
            align="right"
          />
        </View>
        <View style={styles.figures}>
          <Stat label="Weekdays" value={value(summary.weekdayCalories)} />
          <Stat
            label="Weekends"
            value={value(summary.weekendCalories)}
            align="right"
          />
        </View>
        {summary.averageProtein != null ? (
          <MacroTargets
            protein={summary.averageProtein}
            carbs={summary.averageCarbs ?? 0}
            fat={summary.averageFat ?? 0}
          />
        ) : null}
        {logged.length >= 2 ? (
          <>
            <Readout>
              {picked
                ? `${formatIsoDate(picked.date)} · ate ${value(picked.calories > 0 ? picked.calories : null)} · 7-day ${value(picked.rolling7Calories)} · 28-day ${value(picked.rolling28Calories)}`
                : "Rolling averages of logged days: 7-day solid, 28-day dashed."}
            </Readout>
            <LinesChart
              dates={dates}
              series={series}
              formatTick={(tick) => formatInteger(tick)}
              minSpan={toEnergy(200)}
              selectedDate={selected}
              onSelectDate={setSelected}
              accessibilityLabel={`Rolling intake chart, average ${value(summary.averageCalories)} ${unit}`}
            />
          </>
        ) : null}
      </View>
    </Section>
  );
}

function MacroSplitSection({ data }: { data: MacrosStatistics }) {
  const [selected, setSelected] = useState<string | null>(null);
  const days = useMemo(() => macroShares(data.series), [data.series]);
  const split = averageSplit(data.summary);
  if (!split) return null;
  const picked = days.find((day) => day.date === selected);
  const shown = picked ?? split;

  return (
    <Section title="Macro split">
      <View style={styles.block}>
        <View style={styles.split}>
          {(
            [
              ["Protein", shown.protein, macroColors.protein],
              ["Carbs", shown.carbs, macroColors.carbs],
              ["Fat", shown.fat, macroColors.fat],
            ] as const
          ).map(([label, share, color]) => (
            <View key={label} style={styles.splitItem}>
              <View style={[styles.swatch, { backgroundColor: color }]} />
              <Text variant="subheadline" tone="secondary">
                {label}
              </Text>
              <Text variant="subheadline" weight="semibold" figure>
                {formatPercent(share)}
              </Text>
            </View>
          ))}
        </View>
        <Readout>
          {picked
            ? formatIsoDate(picked.date)
            : "Share of calories from each macro, per logged day."}
        </Readout>
        {days.length >= 2 ? (
          <MacroShareChart
            days={days}
            selectedDate={selected}
            onSelectDate={setSelected}
          />
        ) : null}
      </View>
    </Section>
  );
}

function WeightSection({
  data,
  weightUnit,
}: {
  data: MacrosStatistics;
  weightUnit: WeightUnit;
}) {
  const resolved = useResolvedColors();
  const [selected, setSelected] = useState<string | null>(null);
  const summary = data.summary;
  const comparison = useMemo(() => modelVsReality(data.series), [data.series]);
  const hasModel =
    comparison.predicted.filter((value) => value != null).length >= 2 &&
    comparison.actual.filter((value) => value != null).length >= 2;
  const series = useMemo(
    () => [
      {
        key: "actual",
        label: "Trend",
        values: comparison.actual.map((kg) =>
          kg == null ? null : weightValue(kg, weightUnit),
        ),
        color: resolved.label,
        width: 2,
      },
      {
        key: "predicted",
        label: "Predicted",
        values: comparison.predicted.map((kg) =>
          kg == null ? null : weightValue(kg, weightUnit),
        ),
        color: resolved.secondaryLabel,
        dashed: true,
      },
    ],
    [comparison, resolved, weightUnit],
  );
  const index = selected ? comparison.dates.indexOf(selected) : -1;
  const delta = (kg: number | null | undefined) =>
    kg == null ? "—" : formatWeightDelta(kg, weightUnit);

  return (
    <Section title="Weight">
      <View style={styles.block}>
        <View style={styles.figures}>
          <Stat
            label="Change"
            value={delta(summary.weightChangeKg)}
            size="large"
          />
          <Stat
            label="Rate"
            value={
              summary.rateKgPerWeek == null
                ? "—"
                : formatWeeklyRate(summary.rateKgPerWeek, weightUnit)
            }
            detail={
              summary.ratePercentBodyWeightPerWeek == null
                ? undefined
                : `${formatDecimal(summary.ratePercentBodyWeightPerWeek)}% of body weight`
            }
            align="right"
          />
        </View>
        <Text variant="footnote" tone="secondary">
          {summary.projection
            ? `At this rate you reach your goal around ${formatIsoDate(summary.projection.date, "d MMM yyyy")}, give or take ${summary.projection.uncertaintyWeeks} weeks.`
            : "A goal date is projected once there are two weeks of trend moving toward your goal."}
        </Text>
        {hasModel ? (
          <>
            <Readout>
              {index >= 0
                ? `${formatIsoDate(comparison.dates[index] ?? "")} · trend ${delta(comparison.actual[index])} · predicted ${delta(comparison.predicted[index])}`
                : "Trend change (solid) against the change your logged calories predict (dashed). Close lines mean the estimate matches your scale."}
            </Readout>
            <LinesChart
              dates={comparison.dates}
              series={series}
              formatTick={(tick) => formatDecimal(tick)}
              minSpan={weightUnit === "lb" ? 2 : 1}
              zeroLine
              selectedDate={selected}
              onSelectDate={setSelected}
              accessibilityLabel="Predicted against actual weight change"
            />
          </>
        ) : null}
      </View>
    </Section>
  );
}

function AdherenceSection({
  data,
  energyUnit,
  toEnergy,
}: {
  data: MacrosStatistics;
  energyUnit: EnergyUnit;
  toEnergy: (kcal: number) => number;
}) {
  const unit = energyLabel(energyUnit);
  const { averageAbsoluteTargetDistance: distance, longestLoggingStreak } =
    data.summary;
  const weeks = [...data.weekly].reverse().slice(0, 8);

  return (
    <Section title="Adherence">
      <View style={styles.block}>
        <View style={styles.figures}>
          <Stat
            label="Off target"
            value={
              distance == null ? "—" : `± ${formatInteger(toEnergy(distance))}`
            }
            unit={distance == null ? undefined : unit}
            detail="average per logged day"
          />
          <Stat
            label="Longest streak"
            value={formatInteger(longestLoggingStreak)}
            unit="days"
            align="right"
          />
        </View>
        {weeks.length > 0 ? (
          <View>
            {weeks.map((week, index) => {
              const actual =
                week.loggedDays > 0 ? week.calories / week.loggedDays : 0;
              const planned =
                week.loggedDays > 0
                  ? week.plannedCalories / week.loggedDays
                  : 0;
              return (
                <Row
                  key={week.week}
                  title={`Week of ${formatIsoDate(week.week, "d MMM")}`}
                  subtitle={`${week.loggedDays} days logged · ${week.fullDays} complete${
                    planned > 0
                      ? ` · ${formatSignedEnergy(actual - planned, energyUnit)} a day`
                      : ""
                  }`}
                  value={
                    planned > 0
                      ? `${formatInteger(toEnergy(actual))} / ${formatInteger(toEnergy(planned))}`
                      : formatInteger(toEnergy(actual))
                  }
                  separator={index < weeks.length - 1}
                />
              );
            })}
          </View>
        ) : null}
      </View>
    </Section>
  );
}

function TimeOfDaySection({
  data,
  timezone,
}: {
  data: MacrosStatistics;
  timezone: string;
}) {
  const hours = useMemo(() => {
    const offset = Math.round(getTimezoneOffset(timezone) / 3_600_000);
    return caloriesByLocalHour(
      data.timeOfDay,
      Number.isFinite(offset) ? offset : 0,
    );
  }, [data.timeOfDay, timezone]);
  if (!data.timeOfDay.some((hour) => hour.calories > 0)) return null;

  return (
    <Section title="Time of day">
      <View style={styles.hours}>
        <HourBars hours={hours} />
        <View style={styles.hourAxis}>
          {["00", "06", "12", "18", "24"].map((label) => (
            <Text key={label} variant="caption2" tone="secondary" figure>
              {label}
            </Text>
          ))}
        </View>
      </View>
    </Section>
  );
}

function TopFoodsSection({
  data,
  energyUnit,
}: {
  data: MacrosStatistics;
  energyUnit: EnergyUnit;
}) {
  const [by, setBy] =
    useState<(typeof TOP_FOOD_OPTIONS)[number]["value"]>("count");
  const foods = by === "count" ? data.topFoods : data.topFoodsByCalories;
  if (data.topFoods.length === 0) return null;
  const totalCalories = data.series.reduce(
    (sum, point) => sum + point.calories,
    0,
  );

  return (
    <Section title="Top foods">
      <View style={styles.block}>
        <Segmented options={TOP_FOOD_OPTIONS} value={by} onChange={setBy} />
        <View>
          {foods.map((food, index) => (
            <Row
              key={food.name}
              leading={
                <Text
                  variant="subheadline"
                  tone="tertiary"
                  figure
                  style={styles.rank}
                >
                  {index + 1}
                </Text>
              }
              title={food.name}
              subtitle={
                by === "count"
                  ? `${formatInteger(energyValue(food.calories, energyUnit))} ${energyLabel(energyUnit)} in total`
                  : totalCalories > 0
                    ? `${formatPercent((food.calories / totalCalories) * 100)} of everything logged`
                    : undefined
              }
              value={
                by === "count"
                  ? `${food.count}×`
                  : formatInteger(energyValue(food.calories, energyUnit))
              }
              separator={index < foods.length - 1}
            />
          ))}
        </View>
      </View>
    </Section>
  );
}

function ShortfallsSection({ data }: { data: MacrosStatistics }) {
  const resolved = useResolvedColors();
  const shortfalls = data.nutrientShortfalls.slice(0, 8);
  return (
    <Section
      title="Shortfalls"
      footer="Nutrients averaging under 80% of the WHO reference, counting only days with data for them."
    >
      {shortfalls.length === 0 ? (
        <Text variant="subheadline" tone="secondary">
          Nothing is consistently short in this period.
        </Text>
      ) : (
        shortfalls.map((item, index) => {
          const definition = isNutrientKey(item.key)
            ? nutrientNames.get(item.key)
            : undefined;
          const unit = definition?.unit ?? "";
          return (
            <View key={item.key} style={styles.shortfall}>
              <View style={styles.shortfallHeader}>
                <Text variant="body" style={styles.flex}>
                  {definition?.label ?? item.key}
                </Text>
                <Text variant="body" figure>
                  {formatPercent(item.percent)}
                </Text>
              </View>
              <Meter
                progress={item.percent / 100}
                color={resolved.secondaryLabel}
              />
              <Text variant="footnote" tone="secondary" figure>
                {`${formatDecimal(item.average)} of ${formatDecimal(item.reference)} ${unit} a day · ${item.daysWithData} days of data`}
              </Text>
              {index < shortfalls.length - 1 ? (
                <View style={styles.gap} />
              ) : null}
            </View>
          );
        })
      )}
    </Section>
  );
}

function TargetHistorySection({
  data,
  energyUnit,
}: {
  data: MacrosStatistics;
  energyUnit: EnergyUnit;
}) {
  if (data.targetHistory.length === 0) return null;
  const issues = data.targetHistory.slice(0, 10);
  return (
    <Section title="Target changes">
      {issues.map((issue, index) => (
        <Row
          key={issue.id}
          title={formatIsoDate(issue.date, "EEE d MMM yyyy")}
          subtitle={[
            planReasonLabel(issue.reason),
            issue.deltaCalories != null && Math.round(issue.deltaCalories) !== 0
              ? formatSignedEnergy(issue.deltaCalories, energyUnit)
              : null,
            issueStatusLabel(issue.status),
          ]
            .filter(Boolean)
            .join(" · ")}
          value={
            issue.calories == null
              ? "—"
              : `${formatInteger(energyValue(issue.calories, energyUnit))} ${energyLabel(energyUnit)}`
          }
          separator={index < issues.length - 1}
        />
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  spinner: {
    paddingVertical: spacing.xxxl,
  },
  block: {
    gap: spacing.lg,
  },
  figures: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    columnGap: spacing.md,
    rowGap: spacing.sm,
  },
  split: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.lg,
    rowGap: spacing.xs,
  },
  splitItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  swatch: {
    width: 10,
    height: 3,
    borderRadius: 1.5,
  },
  hours: {
    gap: spacing.sm,
  },
  hourAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rank: {
    minWidth: 20,
  },
  shortfall: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  shortfallHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
  gap: {
    height: spacing.xs,
  },
});
