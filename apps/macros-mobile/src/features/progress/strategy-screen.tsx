import { PROTEIN_PROFILES } from "@repo/macros-core/wizard/calc";
import type {
  MacrosActiveGoal,
  MacrosProgram,
  MacrosTargetIssue,
} from "@repo/schemas/macros";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import {
  useAcceptIssue,
  useCheckIn,
  useNutritionProgram,
  useStrategy,
} from "@/api/strategy";
import { errorMessage } from "@/lib/api";
import {
  type EnergyUnit,
  energyLabel,
  energyValue,
  formatInteger,
  type WeightUnit,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  Button,
  EmptyState,
  Flash,
  InlineNotice,
  Row,
  Screen,
  Section,
  Stat,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { toolbarText } from "@/ui/toolbar";
import {
  checkInWeekdayNames,
  confidenceRadius,
  dietPhaseOptions,
  formatEnergyWithUnit,
  formatIsoDate,
  formatSignedEnergy,
  formatWeeklyRate,
  goalTypeOptions,
  goalTypeTitle,
  issueStatusLabel,
  labelFor,
  planReasonLabel,
  planWeekdayNames,
  planWeekdayOf,
  programModeOptions,
} from "./labels";
import { progressPaths } from "./routes";
import { DayTargets, MacroTargets } from "./target-figures";
import { useRefresh } from "./use-refresh";
import { useUnits } from "./use-units";

const HISTORY_PAGE = 6;

export function StrategyScreen() {
  const router = useRouter();
  const { energyUnit, weightUnit, today } = useUnits();
  const programQuery = useNutritionProgram();
  const strategy = useStrategy();
  const program = programQuery.data?.program ?? null;
  const checkIn = useCheckIn({ enabled: program != null });
  const { refreshing, onRefresh } = useRefresh([
    programQuery.refetch,
    strategy.refetch,
    checkIn.refetch,
  ]);

  const issues = programQuery.data?.issues ?? [];
  const active = issues.find((issue) => issue.status === "active") ?? null;
  const pending =
    issues.find((issue) => issue.status === "pending_acceptance") ?? null;
  const plan = strategy.data?.plan ?? null;
  const goal = strategy.data?.goal ?? null;
  const openEditor = () => router.push(progressPaths.program);
  const openCheckIn = () => router.push(progressPaths.checkIn);

  const error = programQuery.error ?? strategy.error;
  const loading = programQuery.isPending;

  return (
    <>
      {program ? (
        <Stack.Toolbar placement="right">
          {toolbarText({
            onPress: openEditor,
            children: "Edit",
          })}
        </Stack.Toolbar>
      ) : null}
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        <VStack>
          {error && !programQuery.data ? (
            <InlineNotice
              message={errorMessage(error)}
              action={{ label: "Retry", onPress: onRefresh }}
            />
          ) : null}

          {loading ? (
            <ActivityIndicator style={styles.spinner} />
          ) : !program ? (
            <EmptyState
              icon="target"
              title="No program yet"
              message="Choose a goal and how you like to eat. Macros turns it into daily targets and adjusts them every week."
            >
              <Button
                label="Set up program"
                size="regular"
                onPress={openEditor}
              />
            </EmptyState>
          ) : (
            <>
              <CheckInCall
                due={checkIn.data?.due ?? false}
                scheduledOn={checkIn.data?.scheduledOn ?? null}
                nextOn={checkIn.data?.nextOn ?? null}
                today={today}
                onPress={openCheckIn}
              />

              {pending ? (
                <PendingIssue
                  issue={pending}
                  current={active}
                  energyUnit={energyUnit}
                />
              ) : null}

              <Flash token={active?.id}>
                <Section title="This week">
                  {active ? (
                    <CurrentTargets
                      issue={active}
                      days={plan && plan.id === active.id ? plan.days : []}
                      todayWeekday={planWeekdayOf(today)}
                      energyUnit={energyUnit}
                    />
                  ) : (
                    <Text variant="subheadline" tone="secondary">
                      No targets are active right now.
                    </Text>
                  )}
                </Section>
              </Flash>

              <ProgramSummary
                program={program}
                goal={goal}
                energyUnit={energyUnit}
                weightUnit={weightUnit}
                onEdit={openEditor}
              />

              <CheckInHistory issues={issues} energyUnit={energyUnit} />
            </>
          )}
        </VStack>
      </Screen>
    </>
  );
}

function CheckInCall({
  due,
  scheduledOn,
  nextOn,
  today,
  onPress,
}: {
  due: boolean;
  scheduledOn: string | null;
  nextOn: string | null;
  today: string;
  onPress: () => void;
}) {
  const when = due
    ? scheduledOn === today
      ? "Due today"
      : scheduledOn
        ? `Due since ${formatIsoDate(scheduledOn)}`
        : null
    : nextOn
      ? `Next check-in ${formatIsoDate(nextOn)}`
      : null;
  return (
    <View style={styles.checkIn}>
      <Button
        label={due ? "Check in" : "Check in early"}
        variant={due ? "filled" : "tinted"}
        icon="target"
        onPress={onPress}
      />
      {when ? (
        <Text variant="footnote" tone="secondary" style={styles.checkInWhen}>
          {when}
        </Text>
      ) : null}
    </View>
  );
}

function PendingIssue({
  issue,
  current,
  energyUnit,
}: {
  issue: MacrosTargetIssue;
  current: MacrosTargetIssue | null;
  energyUnit: EnergyUnit;
}) {
  const accept = useAcceptIssue();
  const change =
    current != null
      ? issue.calorieTarget - current.calorieTarget
      : issue.deltaFromPreviousCalories;

  return (
    <Section
      title="New targets"
      footer="Your current targets stay in place until you accept."
    >
      <View style={styles.block}>
        {accept.error ? (
          <InlineNotice message={errorMessage(accept.error)} />
        ) : null}
        <View style={styles.figures}>
          <Stat
            label={`From ${formatIsoDate(issue.effectiveFrom)}`}
            value={formatInteger(energyValue(issue.calorieTarget, energyUnit))}
            unit={energyLabel(energyUnit)}
            size="large"
            detail={
              change != null && Math.round(change) !== 0
                ? `${formatSignedEnergy(change, energyUnit)} vs now`
                : "Same calories as now"
            }
          />
        </View>
        <MacroTargets
          protein={issue.proteinTarget}
          carbs={issue.carbsTarget}
          fat={issue.fatTarget}
        />
        {issue.tdeeAtIssue != null ? (
          <Text variant="footnote" tone="secondary">
            {expenditureSentence(issue, energyUnit)}
          </Text>
        ) : null}
        <Button
          label="Accept new targets"
          loading={accept.isPending}
          onPress={() =>
            accept.mutate(issue.id, {
              onSuccess: () => haptics.success(),
              onError: () => haptics.error(),
            })
          }
        />
      </View>
    </Section>
  );
}

function CurrentTargets({
  issue,
  days,
  todayWeekday,
  energyUnit,
}: {
  issue: MacrosTargetIssue;
  days: Parameters<typeof DayTargets>[0]["days"];
  todayWeekday: number;
  energyUnit: EnergyUnit;
}) {
  const delta = issue.deltaFromPreviousCalories;
  return (
    <View style={styles.block}>
      <View style={styles.figures}>
        <Stat
          label="Calories"
          value={formatInteger(energyValue(issue.calorieTarget, energyUnit))}
          unit={energyLabel(energyUnit)}
          size="hero"
          detail={
            delta != null && Math.round(delta) !== 0
              ? `${formatSignedEnergy(delta, energyUnit)} from the previous target`
              : undefined
          }
        />
      </View>
      <MacroTargets
        protein={issue.proteinTarget}
        carbs={issue.carbsTarget}
        fat={issue.fatTarget}
      />
      <Text variant="footnote" tone="secondary">
        {`Since ${formatIsoDate(issue.effectiveFrom)} · ${planReasonLabel(issue.reason)}`}
        {issue.tdeeAtIssue != null
          ? `\n${expenditureSentence(issue, energyUnit)}`
          : ""}
      </Text>
      <DayTargets
        days={days}
        todayWeekday={todayWeekday}
        energyUnit={energyUnit}
      />
    </View>
  );
}

function ProgramSummary({
  program,
  goal,
  energyUnit,
  weightUnit,
  onEdit,
}: {
  program: MacrosProgram;
  goal: MacrosActiveGoal | null;
  energyUnit: EnergyUnit;
  weightUnit: WeightUnit;
  onEdit: () => void;
}) {
  const mode = programModeOptions.find(
    (option) => option.value === program.mode,
  );
  const profile = PROTEIN_PROFILES.find(
    (option) => option.value === program.distributionProfile,
  );
  const rate =
    goal?.weeklyRateKg != null && program.goalType !== "maintain"
      ? formatWeeklyRate(
          program.goalType === "lose" ? -goal.weeklyRateKg : goal.weeklyRateKg,
          weightUnit,
        )
      : null;
  const cycling = program.calorieCycling;
  const highDays =
    cycling.highDays.length > 0 && cycling.highDayAdjustment > 0
      ? `${[...cycling.highDays]
          .sort((a, b) => a - b)
          .map((day) => planWeekdayNames[day]?.slice(0, 3))
          .join(
            ", ",
          )} · ${formatSignedEnergy(cycling.highDayAdjustment, energyUnit)}`
      : "Off";

  const rows: Array<{ title: string; value: string; subtitle?: string }> = [
    {
      title: "Mode",
      value: mode?.label ?? program.mode,
      subtitle: mode?.description,
    },
    {
      title: "Goal",
      value: rate ?? labelFor(goalTypeOptions, program.goalType),
      subtitle: goalTypeTitle(program.goalType),
    },
    { title: "Phase", value: labelFor(dietPhaseOptions, program.dietPhase) },
    ...(program.mode === "manual" && program.manualCalorieTarget != null
      ? [
          {
            title: "Calorie target",
            value: formatEnergyWithUnit(
              program.manualCalorieTarget,
              energyUnit,
            ),
          },
        ]
      : []),
    {
      title: "Protein",
      value: `${program.proteinGramsPerKg.toFixed(1)} g/kg`,
      subtitle: profile ? `${profile.label} split` : undefined,
    },
    {
      title: "Fat",
      value:
        program.fatGramsPerKg != null
          ? `${program.fatGramsPerKg.toFixed(1)} g/kg`
          : program.fatPercent != null
            ? `${Math.round(program.fatPercent)}% of calories`
            : "30% of calories",
    },
    { title: "High days", value: highDays },
    {
      title: "Check-in",
      value: checkInWeekdayNames[program.checkInWeekday] ?? "—",
    },
  ];

  return (
    <Section
      title="Program"
      footer="Macros estimates what you burn from your logs and weigh-ins. Each check-in turns that estimate and your goal into next week’s targets."
    >
      {rows.map((row, index) => (
        <Row
          key={row.title}
          title={row.title}
          subtitle={row.subtitle}
          value={row.value}
          separator={index < rows.length - 1}
          onPress={onEdit}
        />
      ))}
    </Section>
  );
}

function CheckInHistory({
  issues,
  energyUnit,
}: {
  issues: readonly MacrosTargetIssue[];
  energyUnit: EnergyUnit;
}) {
  const [limit, setLimit] = useState(HISTORY_PAGE);
  if (issues.length === 0) return null;
  const shown = issues.slice(0, limit);
  return (
    <Section title="Check-ins">
      {shown.map((issue, index) => {
        const status = issueStatusLabel(issue.status);
        const delta = issue.deltaFromPreviousCalories;
        return (
          <Row
            key={issue.id}
            title={formatIsoDate(issue.effectiveFrom, "EEE d MMM yyyy")}
            subtitle={[
              planReasonLabel(issue.reason),
              delta != null && Math.round(delta) !== 0
                ? formatSignedEnergy(delta, energyUnit)
                : null,
              status,
            ]
              .filter(Boolean)
              .join(" · ")}
            value={formatEnergyWithUnit(issue.calorieTarget, energyUnit)}
            valueTone={issue.status === "archived" ? "secondary" : "primary"}
            separator={index < shown.length - 1 || issues.length > limit}
          />
        );
      })}
      {issues.length > limit ? (
        <Row
          title={`Show ${issues.length - limit} earlier`}
          icon="chevron-down"
          separator={false}
          onPress={() => setLimit(issues.length)}
        />
      ) : null}
    </Section>
  );
}

function expenditureSentence(
  issue: MacrosTargetIssue,
  unit: EnergyUnit,
): string {
  if (issue.tdeeAtIssue == null) return "";
  const radius =
    issue.tdeeVarianceAtIssue != null
      ? confidenceRadius(issue.tdeeVarianceAtIssue)
      : null;
  return `Estimated expenditure at the time: ${formatEnergyWithUnit(issue.tdeeAtIssue, unit)}${
    radius ? ` ± ${formatInteger(energyValue(radius, unit))}` : ""
  }.`;
}

const styles = StyleSheet.create({
  checkIn: {
    gap: spacing.sm,
  },
  checkInWhen: {
    textAlign: "center",
  },
  spinner: {
    paddingVertical: spacing.xxxl,
  },
  block: {
    gap: spacing.lg,
  },
  figures: {
    flexDirection: "row",
    gap: spacing.lg,
  },
});
