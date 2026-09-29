import type {
  MacrosActiveGoal,
  MacrosGoalHistoryEntry,
} from "@repo/schemas/macros";
import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { useActiveGoal, useGoalHistory, useReopenGoal } from "@/api/goals";
import { useStatistics } from "@/api/statistics";
import { useWeightOverview } from "@/api/weight";
import { errorMessage } from "@/lib/api";
import { formatWeight, type WeightUnit } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  EmptyState,
  Flash,
  Icon,
  InlineNotice,
  Meter,
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
import { glyphs } from "@/ui/glyphs";
import {
  formatIsoDate,
  formatWeeklyRate,
  formatWeightNumber,
  goalTypeOptions,
  goalTypeTitle,
  labelFor,
} from "./labels";
import { progressPaths } from "./routes";
import { useRefresh } from "./use-refresh";
import { useUnits } from "./use-units";
import { currentWeightKg, goalProgress } from "./weight-progress";

export function GoalsScreen() {
  const router = useRouter();
  const { weightUnit } = useUnits();
  const goal = useActiveGoal();
  const history = useGoalHistory();
  const overview = useWeightOverview();
  const statistics = useStatistics("28d");
  const reopen = useReopenGoal();
  const { refreshing, onRefresh } = useRefresh([
    goal.refetch,
    history.refetch,
    overview.refetch,
    statistics.refetch,
  ]);

  const active = goal.data ?? null;
  const closed = (history.data ?? []).filter((entry) => !entry.isActive);
  const error = goal.error ?? history.error;

  const openNew = () =>
    router.push({ pathname: progressPaths.goal, params: { mode: "new" } });
  const openEdit = () =>
    router.push({ pathname: progressPaths.goal, params: { mode: "edit" } });

  const confirmReopen = (entry: MacrosGoalHistoryEntry) => {
    Alert.alert(
      "Reopen this goal?",
      active
        ? "Your current goal moves to history, and your targets are recalculated."
        : "Your targets are recalculated for it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reopen",
          onPress: () =>
            reopen.mutate(entry.id, {
              onSuccess: () => haptics.success(),
              onError: () => haptics.error(),
            }),
        },
      ],
    );
  };

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphs.plus}
          iconRenderingMode="template"
          accessibilityLabel="New goal"
          onPress={openNew}
        />
      </Stack.Toolbar>
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        <VStack>
          {error && !goal.data ? (
            <InlineNotice
              message={errorMessage(error)}
              action={{ label: "Retry", onPress: onRefresh }}
            />
          ) : null}
          {reopen.error ? (
            <InlineNotice
              message={errorMessage(reopen.error)}
              onDismiss={() => reopen.reset()}
            />
          ) : null}

          {goal.isPending ? (
            <ActivityIndicator style={styles.spinner} />
          ) : active ? (
            <Flash token={active.id}>
              <Section
                title="Current goal"
                action={{ label: "Edit", onPress: openEdit }}
              >
                <ActiveGoalDetail
                  goal={active}
                  currentKg={currentWeightKg(overview.data)}
                  unit={weightUnit}
                  projection={statistics.data?.summary.projection ?? null}
                />
              </Section>
            </Flash>
          ) : (
            <EmptyState
              icon="flag"
              title="No active goal"
              message="A goal gives your weekly targets a direction and a pace."
            >
              <View style={styles.emptyActions}>
                <Button
                  label="Set a goal"
                  size="regular"
                  block={false}
                  onPress={openNew}
                />
                {closed[0] ? (
                  <Button
                    label="Reopen last goal"
                    variant="tinted"
                    size="regular"
                    block={false}
                    loading={reopen.isPending}
                    onPress={() => {
                      const latest = closed[0];
                      if (latest) confirmReopen(latest);
                    }}
                  />
                ) : null}
              </View>
            </EmptyState>
          )}

          {closed.length > 0 ? (
            <Section
              title="History"
              footer="Tap a past goal, or swipe it right, to make it your goal again."
            >
              {closed.map((entry, index) => (
                <SwipeRow
                  key={entry.id}
                  actions={[]}
                  leadingActions={[
                    {
                      label: "Reopen",
                      icon: "undo-2",
                      onPress: () => confirmReopen(entry),
                    },
                  ]}
                >
                  <HistoryRow
                    entry={entry}
                    unit={weightUnit}
                    separator={index < closed.length - 1}
                    onPress={() => confirmReopen(entry)}
                  />
                </SwipeRow>
              ))}
            </Section>
          ) : null}
        </VStack>
      </Screen>
    </>
  );
}

function ActiveGoalDetail({
  goal,
  currentKg,
  unit,
  projection,
}: {
  goal: MacrosActiveGoal;
  currentKg: number | null;
  unit: WeightUnit;
  projection: { date: string; uncertaintyWeeks: number } | null;
}) {
  const resolved = useResolvedColors();
  const progress = goalProgress(goal, currentKg);
  const rate =
    goal.goalType === "maintain" || goal.weeklyRateKg == null
      ? null
      : formatWeeklyRate(
          goal.goalType === "lose" ? -goal.weeklyRateKg : goal.weeklyRateKg,
          unit,
        );

  const rows = [
    { title: "Target rate", value: rate ?? "—" },
    {
      title: progress.reached ? "Past the goal by" : "Still to go",
      value:
        progress.remainingKg == null
          ? "—"
          : formatWeight(Math.abs(progress.remainingKg), unit),
    },
    {
      title: "Target date",
      value: goal.targetDate
        ? formatIsoDate(goal.targetDate, "d MMM yyyy")
        : "None",
    },
    {
      title: "Projected",
      value: projection
        ? `${formatIsoDate(projection.date, "d MMM yyyy")} ± ${projection.uncertaintyWeeks} wk`
        : "Not enough trend yet",
    },
  ];

  return (
    <View style={styles.block}>
      <View>
        <Text variant="title3">{goalTypeTitle(goal.goalType)}</Text>
        <Text variant="footnote" tone="secondary">
          Since {formatIsoDate(goal.startDate, "d MMM yyyy")}
        </Text>
      </View>
      <View style={styles.figures}>
        <Stat
          label="Start"
          value={
            goal.startWeightKg == null
              ? "—"
              : formatWeightNumber(goal.startWeightKg, unit)
          }
          unit={goal.startWeightKg == null ? undefined : unit}
        />
        <Stat
          label="Now"
          value={currentKg == null ? "—" : formatWeightNumber(currentKg, unit)}
          unit={currentKg == null ? undefined : unit}
          align="center"
        />
        <Stat
          label="Goal"
          value={
            goal.targetWeightKg == null
              ? "—"
              : formatWeightNumber(goal.targetWeightKg, unit)
          }
          unit={goal.targetWeightKg == null ? undefined : unit}
          align="right"
        />
      </View>
      {progress.fraction != null ? (
        <Meter progress={progress.fraction} color={resolved.label} />
      ) : null}
      <View>
        {rows.map((row, index) => (
          <Row
            key={row.title}
            title={row.title}
            value={row.value}
            separator={index < rows.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

function HistoryRow({
  entry,
  unit,
  separator,
  onPress,
}: {
  entry: MacrosGoalHistoryEntry;
  unit: WeightUnit;
  separator: boolean;
  onPress: () => void;
}) {
  const from =
    entry.startWeightKg == null
      ? "—"
      : formatWeightNumber(entry.startWeightKg, unit);
  const to =
    entry.endWeightKg != null
      ? formatWeightNumber(entry.endWeightKg, unit)
      : entry.targetWeightKg != null
        ? formatWeightNumber(entry.targetWeightKg, unit)
        : "—";
  const period = `${formatIsoDate(entry.startDate, "d MMM yyyy")} – ${
    entry.closedAt ? formatIsoDate(entry.closedAt, "d MMM yyyy") : "now"
  }`;
  const target =
    entry.targetWeightKg != null
      ? `aimed for ${formatWeight(entry.targetWeightKg, unit)}`
      : null;

  return (
    <Row
      title={`${labelFor(goalTypeOptions, entry.goalType)} · ${from} → ${to} ${unit}`}
      subtitle={[period, target].filter(Boolean).join(" · ")}
      separator={separator}
      onPress={onPress}
      accessibilityHint="Reopens this goal"
      trailing={
        <Icon
          name={entry.achieved ? "circle-check" : "circle-dashed"}
          size={20}
          color={entry.achieved ? colors.label : colors.tertiaryLabel}
          accessibilityLabel={entry.achieved ? "Reached" : "Not reached"}
        />
      }
    />
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
    justifyContent: "space-between",
    gap: spacing.md,
  },
  emptyActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
