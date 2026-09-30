import type {
  MacrosProgramsResponse,
  MacrosWeighInItem,
} from "@repo/schemas/macros";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useActiveGoal } from "@/api/goals";
import { useStatistics } from "@/api/statistics";
import { useCheckIn, useNutritionProgram } from "@/api/strategy";
import {
  useDeleteWeighIn,
  useUpsertWeighIn,
  useWeightOverview,
} from "@/api/weight";
import { errorMessage } from "@/lib/api";
import {
  type EnergyUnit,
  energyLabel,
  energyValue,
  formatDayLabel,
  formatEnergy,
  formatInteger,
  formatWeight,
  formatWeightDelta,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  Button,
  EmptyState,
  Flash,
  HeaderIconButton,
  InlineNotice,
  Meter,
  PageHeader,
  Row,
  Screen,
  Section,
  Stat,
  SwipeRow,
  spacing,
  Text,
  useResolvedColors,
  VStack,
} from "@/ui";
import { ExpenditureChart, WeightTrendChart } from "./charts";
import { Segmented } from "./controls";
import {
  formatIsoDate,
  formatPercent,
  formatSignedEnergy,
  formatWeeklyRate,
  formatWeightNumber,
  labelFor,
  programModeOptions,
} from "./labels";
import { progressPaths } from "./routes";
import { useRefresh } from "./use-refresh";
import { useUnits } from "./use-units";
import {
  currentWeightKg,
  goalProgress,
  summarizeExpenditure,
  summarizeTrend,
  trendForRange,
  type WeightRange,
  weightRanges,
} from "./weight-progress";

const RANGE_OPTIONS = weightRanges.map((range) => ({
  value: range,
  label: range,
}));
const PAGE = 10;

export function ProgressScreen() {
  const router = useRouter();
  const { weightUnit, energyUnit, today } = useUnits();
  const overview = useWeightOverview();
  const goal = useActiveGoal();
  const statistics = useStatistics("28d");
  const program = useNutritionProgram();
  const checkIn = useCheckIn({ enabled: program.data?.program != null });
  const [range, setRange] = useState<WeightRange>("3M");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { refreshing, onRefresh } = useRefresh([
    overview.refetch,
    goal.refetch,
    statistics.refetch,
    program.refetch,
  ]);

  const points = useMemo(
    () => (overview.data ? trendForRange(overview.data, range) : []),
    [overview.data, range],
  );
  const summary = summarizeTrend(points);
  const selected = points.find((point) => point.date === selectedDate);
  const activeGoal = goal.data ?? null;
  const toEnergy = (kcal: number) => energyValue(kcal, energyUnit);

  const logWeighIn = () => router.push(progressPaths.weighIn);

  return (
    <Screen statusBarScrim onRefresh={onRefresh} refreshing={refreshing}>
      <VStack>
        <PageHeader title="Progress">
          <HeaderIconButton
            icon="plus"
            label="Log weigh-in"
            onPress={logWeighIn}
          />
        </PageHeader>
        {overview.isError && !overview.data ? (
          <InlineNotice
            message={errorMessage(overview.error)}
            action={{
              label: "Retry",
              onPress: () => void overview.refetch(),
            }}
          />
        ) : null}

        <View style={styles.block}>
          <Segmented
            options={RANGE_OPTIONS}
            value={range}
            onChange={(next) => {
              setSelectedDate(null);
              setRange(next);
            }}
          />
          <View style={styles.figures}>
            {selected ? (
              <>
                <Stat
                  label={formatIsoDate(selected.date)}
                  value={formatWeightNumber(selected.trendWeightKg, weightUnit)}
                  unit={weightUnit}
                  detail="trend"
                  size="large"
                />
                <Stat
                  label="Scale"
                  value={
                    selected.scaleWeightKg == null
                      ? "—"
                      : formatWeightNumber(selected.scaleWeightKg, weightUnit)
                  }
                  unit={selected.scaleWeightKg == null ? undefined : weightUnit}
                  detail={
                    selected.scaleWeightKg == null ? "no weigh-in" : undefined
                  }
                />
                <Stat
                  label="Weekly"
                  value={
                    selected.slopeKgPerWeek == null
                      ? "—"
                      : formatWeeklyRate(selected.slopeKgPerWeek, weightUnit)
                  }
                />
              </>
            ) : (
              <>
                <Stat
                  label="Trend"
                  value={
                    summary.trendKg == null
                      ? "—"
                      : formatWeightNumber(summary.trendKg, weightUnit)
                  }
                  unit={summary.trendKg == null ? undefined : weightUnit}
                  size="large"
                />
                <Stat
                  label="Weekly"
                  value={
                    summary.slopeKgPerWeek == null
                      ? "—"
                      : formatWeeklyRate(summary.slopeKgPerWeek, weightUnit)
                  }
                  detail={
                    summary.slopeKgPerWeek == null && points.length > 0
                      ? "needs more weigh-ins"
                      : undefined
                  }
                />
                <Stat
                  label={`Change · ${range}`}
                  value={
                    summary.changeKg == null
                      ? "—"
                      : formatWeightDelta(summary.changeKg, weightUnit)
                  }
                />
              </>
            )}
          </View>

          {overview.isPending ? (
            <View style={styles.chartPlaceholder}>
              <ActivityIndicator />
            </View>
          ) : points.length >= 2 ? (
            <>
              <WeightTrendChart
                points={points}
                goalKg={activeGoal?.targetWeightKg ?? null}
                unit={weightUnit}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
              <ChartLegend
                goalLabel={
                  activeGoal?.targetWeightKg != null
                    ? `Goal ${formatWeight(activeGoal.targetWeightKg, weightUnit)}`
                    : null
                }
              />
            </>
          ) : overview.data ? (
            <View style={styles.chartPlaceholder}>
              <Text variant="subheadline" tone="secondary" align="center">
                {points.length === 1
                  ? "One more weigh-in in this range draws the trend."
                  : "No weigh-ins in this range."}
              </Text>
            </View>
          ) : null}
        </View>

        <ExpenditureSection
          statistics={statistics.data}
          loading={statistics.isPending}
          energyUnit={energyUnit}
          toEnergy={toEnergy}
          onOpen={() => router.push(progressPaths.statistics)}
        />

        <Section
          title="Goal"
          action={{
            label: activeGoal ? "Goals" : "Set",
            onPress: () =>
              activeGoal
                ? router.push(progressPaths.goals)
                : router.push({
                    pathname: progressPaths.goal,
                    params: { mode: "new" },
                  }),
          }}
        >
          {activeGoal ? (
            <GoalSummary
              goal={activeGoal}
              currentKg={currentWeightKg(overview.data)}
              projectionDate={statistics.data?.summary.projection?.date ?? null}
              projectionWeeks={
                statistics.data?.summary.projection?.uncertaintyWeeks ?? null
              }
            />
          ) : goal.isPending ? null : (
            <Text variant="subheadline" tone="secondary">
              No weight goal yet. A goal sets the rate your targets aim for.
            </Text>
          )}
        </Section>

        <Section title="Plan">
          <Row
            icon="sliders-horizontal"
            title="Strategy"
            subtitle={strategySubtitle(
              program.data,
              checkIn.data?.due ?? false,
              energyUnit,
            )}
            chevron
            onPress={() => router.push(progressPaths.strategy)}
          />
          <Row
            icon="flag"
            title="Goals"
            subtitle={
              activeGoal?.targetWeightKg != null
                ? `Aiming for ${formatWeight(activeGoal.targetWeightKg, weightUnit)}`
                : "Current goal and history"
            }
            chevron
            onPress={() => router.push(progressPaths.goals)}
          />
          <Row
            icon="chart-column"
            title="Statistics"
            subtitle="Intake, adherence and export"
            chevron
            separator={false}
            onPress={() => router.push(progressPaths.statistics)}
          />
        </Section>

        <WeighInList
          entries={overview.data?.entries ?? []}
          loaded={overview.data !== undefined}
          today={today}
          onAdd={logWeighIn}
          onOpen={(date) =>
            router.push({ pathname: progressPaths.weighIn, params: { date } })
          }
        />
      </VStack>
    </Screen>
  );
}

function strategySubtitle(
  data: MacrosProgramsResponse | undefined,
  due: boolean,
  unit: EnergyUnit,
): string {
  if (!data?.program) return "Set up your program";
  if (due) return "Check-in due";
  if (data.issues.some((issue) => issue.status === "pending_acceptance")) {
    return "New targets are waiting for you";
  }
  const active = data.issues.find((issue) => issue.status === "active");
  const mode = labelFor(
    programModeOptions,
    data.program.mode === "collaborative" ? "coached" : data.program.mode,
  );
  return active
    ? `${formatEnergy(active.calorieTarget, unit)} ${energyLabel(unit)} · ${mode}`
    : mode;
}

function ChartLegend({ goalLabel }: { goalLabel: string | null }) {
  const resolved = useResolvedColors();
  return (
    <View
      style={styles.legend}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.legendItem}>
        <View
          style={[styles.legendLine, { backgroundColor: resolved.label }]}
        />
        <Text variant="caption1" tone="secondary">
          Trend
        </Text>
      </View>
      <View style={styles.legendItem}>
        <View
          style={[
            styles.legendDot,
            { backgroundColor: resolved.tertiaryLabel },
          ]}
        />
        <Text variant="caption1" tone="secondary">
          Scale
        </Text>
      </View>
      {goalLabel ? (
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendDash,
              { borderColor: resolved.secondaryLabel },
            ]}
          />
          <Text variant="caption1" tone="secondary" figure>
            {goalLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ExpenditureSection({
  statistics,
  loading,
  energyUnit,
  toEnergy,
  onOpen,
}: {
  statistics: Parameters<typeof summarizeExpenditure>[0];
  loading: boolean;
  energyUnit: EnergyUnit;
  toEnergy: (kcal: number) => number;
  onOpen: () => void;
}) {
  const expenditure = summarizeExpenditure(statistics);
  const unitLabel = energyLabel(energyUnit);
  const vsPrior = statistics?.summary.tdeeVsPriorPercent ?? null;
  const prior = statistics?.summary.priorTdee ?? null;

  return (
    <Section title="Expenditure" action={{ label: "Details", onPress: onOpen }}>
      {expenditure.latestKcal != null ? (
        <View style={styles.block}>
          <View style={styles.figures}>
            <Stat
              label="Estimate"
              value={formatInteger(toEnergy(expenditure.latestKcal))}
              unit={unitLabel}
              size="large"
              detail={
                expenditure.lowKcal != null && expenditure.highKcal != null
                  ? `${formatInteger(toEnergy(expenditure.lowKcal))}–${formatInteger(toEnergy(expenditure.highKcal))}`
                  : undefined
              }
            />
            <Stat
              label="28 days"
              value={
                expenditure.changeKcal == null
                  ? "—"
                  : formatSignedEnergy(expenditure.changeKcal, energyUnit)
              }
            />
            <Stat
              label="vs formula"
              value={
                vsPrior == null
                  ? "—"
                  : `${vsPrior > 0 ? "+" : ""}${formatPercent(vsPrior)}`
              }
              detail={
                prior == null
                  ? undefined
                  : `${formatInteger(toEnergy(prior))} ${unitLabel}`
              }
            />
          </View>
          {expenditure.points.length >= 2 ? (
            <ExpenditureChart
              compact
              height={64}
              toUnit={toEnergy}
              points={expenditure.points.map((point) => ({
                date: point.date,
                tdee: point.tdee,
                low: point.low,
                high: point.high,
              }))}
            />
          ) : null}
        </View>
      ) : loading ? (
        <ActivityIndicator style={styles.inlineSpinner} />
      ) : (
        <Text variant="subheadline" tone="secondary">
          {statistics
            ? `Your estimate appears after a few weeks of logging and weigh-ins. Last 28 days: ${statistics.denominator.loggedDays} days logged, ${statistics.denominator.weighIns} weigh-ins.`
            : "Your estimate appears after a few weeks of logging and weigh-ins."}
        </Text>
      )}
    </Section>
  );
}

function GoalSummary({
  goal,
  currentKg,
  projectionDate,
  projectionWeeks,
}: {
  goal: NonNullable<ReturnType<typeof useActiveGoal>["data"]>;
  currentKg: number | null;
  projectionDate: string | null;
  projectionWeeks: number | null;
}) {
  const { weightUnit } = useUnits();
  const resolved = useResolvedColors();
  const progress = goalProgress(goal, currentKg);
  const details = [
    goal.startWeightKg != null
      ? `Started at ${formatWeight(goal.startWeightKg, weightUnit)} on ${formatIsoDate(goal.startDate, "d MMM")}`
      : `Started ${formatIsoDate(goal.startDate, "d MMM")}`,
    projectionDate
      ? `on track for ${formatIsoDate(projectionDate, "d MMM yyyy")}${projectionWeeks ? ` ± ${projectionWeeks} wk` : ""}`
      : null,
  ].filter(Boolean);

  return (
    <View style={styles.block}>
      <View style={styles.figures}>
        <Stat
          label="Goal"
          value={
            goal.targetWeightKg == null
              ? "—"
              : formatWeightNumber(goal.targetWeightKg, weightUnit)
          }
          unit={goal.targetWeightKg == null ? undefined : weightUnit}
          size="large"
        />
        <Stat
          label={progress.reached ? "Reached" : "To go"}
          value={
            progress.remainingKg == null
              ? "—"
              : formatWeight(Math.abs(progress.remainingKg), weightUnit)
          }
        />
        <Stat
          label="Target rate"
          value={
            goal.weeklyRateKg == null || goal.goalType === "maintain"
              ? "—"
              : formatWeeklyRate(
                  goal.goalType === "lose"
                    ? -goal.weeklyRateKg
                    : goal.weeklyRateKg,
                  weightUnit,
                )
          }
        />
      </View>
      {progress.fraction != null ? (
        <Meter progress={progress.fraction} color={resolved.label} />
      ) : null}
      <Text variant="footnote" tone="secondary">
        {details.join(" · ")}
      </Text>
    </View>
  );
}

function WeighInList({
  entries,
  loaded,
  today,
  onAdd,
  onOpen,
}: {
  entries: readonly MacrosWeighInItem[];
  loaded: boolean;
  today: string;
  onAdd: () => void;
  onOpen: (date: string) => void;
}) {
  const { weightUnit } = useUnits();
  const remove = useDeleteWeighIn();
  const restore = useUpsertWeighIn();
  const [limit, setLimit] = useState(PAGE);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [removed, setRemoved] = useState<MacrosWeighInItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoredToken, setRestoredToken] = useState<number | null>(null);

  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), 8000);
    return () => clearTimeout(timer);
  }, [removed]);

  const visible = entries.filter((entry) => !hidden.has(entry.id));
  const shown = visible.slice(0, limit);

  const unhide = (id: string) =>
    setHidden((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });

  const onDelete = (entry: MacrosWeighInItem) => {
    setError(null);
    haptics.warning();
    setHidden((current) => new Set(current).add(entry.id));
    remove.mutate(entry, {
      onSuccess: () => setRemoved(entry),
      onError: (cause) => {
        haptics.error();
        unhide(entry.id);
        setError(errorMessage(cause));
      },
    });
  };

  const onUndo = () => {
    if (!removed) return;
    const entry = removed;
    setRemoved(null);
    restore.mutate(
      {
        logDate: entry.logDate,
        weightKg: entry.weightKg,
        bodyFatPct: entry.bodyFatPct,
        notes: entry.notes,
      },
      {
        onSuccess: () => {
          unhide(entry.id);
          haptics.success();
          setRestoredToken(Date.now());
        },
        onError: (cause) => {
          haptics.error();
          setError(errorMessage(cause));
        },
      },
    );
  };

  return (
    <Section title="Weigh-ins" action={{ label: "Add", onPress: onAdd }}>
      {removed ? (
        <InlineNotice
          tone="info"
          message={`Deleted ${formatWeight(removed.weightKg, weightUnit)} from ${formatDayLabel(removed.logDate, today)}`}
          action={{ label: "Undo", onPress: onUndo }}
          onDismiss={() => setRemoved(null)}
        />
      ) : null}
      {error ? (
        <InlineNotice message={error} onDismiss={() => setError(null)} />
      ) : null}
      {loaded && visible.length === 0 && !restore.isPending ? (
        <EmptyState
          icon="scale"
          title="No weigh-ins yet"
          message="Weigh in a few mornings a week, and your trend fills in here."
        >
          <Button
            label="Log weigh-in"
            size="regular"
            variant="tinted"
            onPress={onAdd}
          />
        </EmptyState>
      ) : (
        <Flash token={restoredToken}>
          {shown.map((entry, index) => (
            <SwipeRow
              key={entry.id}
              actions={[
                {
                  label: "Delete",
                  icon: "trash",
                  destructive: true,
                  onPress: () => onDelete(entry),
                },
              ]}
            >
              <Row
                title={formatDayLabel(entry.logDate, today)}
                subtitle={
                  [
                    entry.bodyFatPct != null
                      ? `${formatPercent(entry.bodyFatPct, 1)} body fat`
                      : null,
                    entry.notes,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
                value={formatWeight(entry.weightKg, weightUnit)}
                valueTone="primary"
                separator={index < shown.length - 1 || visible.length > limit}
                onPress={() => onOpen(entry.logDate)}
                accessibilityHint="Opens this weigh-in. Swipe left to delete."
              />
            </SwipeRow>
          ))}
          {visible.length > limit ? (
            <Row
              title={`Show ${Math.min(visible.length - limit, 30)} more`}
              icon="chevron-down"
              separator={false}
              onPress={() => setLimit((current) => current + 30)}
            />
          ) : null}
        </Flash>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.lg,
  },
  figures: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
    columnGap: spacing.md,
    rowGap: spacing.sm,
  },
  chartPlaceholder: {
    minHeight: 200,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  inlineSpinner: {
    alignSelf: "flex-start",
    paddingVertical: spacing.md,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    marginTop: -spacing.sm,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendLine: {
    width: 14,
    height: 2,
    borderRadius: 1,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendDash: {
    width: 14,
    borderTopWidth: 1,
    borderStyle: "dashed",
  },
});
