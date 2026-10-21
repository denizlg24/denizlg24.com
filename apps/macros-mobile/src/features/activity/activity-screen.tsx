import {
  type ActivityMetric,
  activityAverage,
  activityDays,
} from "@repo/macros-core/activity";
import { format, parseISO } from "date-fns";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Platform } from "react-native";
import { useBodyOverview } from "@/api/body";
import { useProfile } from "@/api/profile";
import { useStatistics } from "@/api/statistics";
import { errorMessage } from "@/lib/api";
import { deviceTimeZone, useToday } from "@/lib/day";
import { energyLabel, formatEnergy, formatInteger } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  EmptyState,
  InlineNotice,
  Row,
  Screen,
  Section,
  Text,
  VStack,
} from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { useRefresh } from "../more/shared/use-refresh";
import { Segmented } from "../progress/controls";
import { summarizeExpenditure } from "../progress/weight-progress";
import { ActivityChart } from "./activity-chart";

const ranges = [
  { label: "Week", value: "7" },
  { label: "Month", value: "28" },
  { label: "3 months", value: "90" },
];
const metrics = [
  { label: "Steps", value: "steps" },
  { label: "Active energy", value: "activeEnergyKcal" },
];

export function MovementScreen() {
  const router = useRouter();
  const profile = useProfile();
  const overview = useBodyOverview();
  const statistics = useStatistics("28d");
  const today = useToday(profile.data?.timezone ?? deviceTimeZone());
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const [range, setRange] = useState("7");
  const [metric, setMetric] = useState<ActivityMetric>("steps");
  const { refreshing, onRefresh } = useRefresh(() =>
    Promise.all([overview.refetch(), statistics.refetch()]),
  );
  const days = activityDays(
    overview.data?.activity ?? [],
    today,
    Number(range),
  );
  const current = days.at(-1);
  const average = activityAverage(days, metric);
  const known = days.filter((day) => day[metric] !== null).length;
  const show = (value: number | null) =>
    value === null
      ? "—"
      : metric === "steps"
        ? formatInteger(value)
        : `${formatEnergy(value, energyUnit)} ${energyLabel(energyUnit)}`;
  const expenditure = summarizeExpenditure(statistics.data);

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={glyphs.plus}
          iconRenderingMode="template"
          accessibilityLabel="Log activity"
          onPress={() => router.push("/progress/activity-edit")}
        />
      </Stack.Toolbar>
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        <VStack>
          {overview.isError ? (
            <InlineNotice
              message={errorMessage(overview.error)}
              action={{
                label: "Try again",
                onPress: () => void overview.refetch(),
              }}
            />
          ) : null}
          {overview.isPending && !overview.data ? (
            <ActivityIndicator accessibilityLabel="Loading activity" />
          ) : null}
          <Section title="Today">
            <Row
              title="Steps"
              value={
                current?.steps == null ? "—" : formatInteger(current.steps)
              }
              subtitle={
                current?.stepsSource === "manual"
                  ? "Manual"
                  : current?.stepsSource === "import"
                    ? "Health / Shortcuts"
                    : "No reading yet"
              }
            />
            <Row
              title="Active energy"
              value={
                current?.activeEnergyKcal == null
                  ? "—"
                  : `${formatEnergy(current.activeEnergyKcal, energyUnit)} ${energyLabel(energyUnit)}`
              }
              subtitle={
                current?.energySource === "manual"
                  ? "Manual"
                  : current?.energySource === "import"
                    ? "Health / Shortcuts"
                    : "No reading yet"
              }
              separator={false}
            />
          </Section>
          <Section title="Movement trend">
            <Segmented
              options={ranges}
              value={range}
              onChange={(value) => {
                haptics.selection();
                setRange(value);
              }}
            />
            <Segmented
              options={metrics}
              value={metric}
              onChange={(value) => {
                if (value === "steps" || value === "activeEnergyKcal") {
                  haptics.selection();
                  setMetric(value);
                }
              }}
            />
            {known > 0 ? (
              <>
                <Text variant="headline">
                  {show(average)}{" "}
                  {metric === "steps" ? "steps per day" : "per day"}
                </Text>
                <Text variant="footnote" tone="secondary">
                  Average across {known} {known === 1 ? "day" : "days"} with
                  readings. Gaps mean no data.
                </Text>
                <ActivityChart days={days} metric={metric} />
                <Text variant="caption1" tone="secondary">
                  {format(parseISO(days[0]!.date), "d MMM")} –{" "}
                  {format(parseISO(today), "d MMM")}
                </Text>
              </>
            ) : !overview.isPending && !overview.isError ? (
              <EmptyState
                title="No activity readings yet"
                message={
                  Platform.OS === "ios"
                    ? "Connect Apple Health, import with Shortcuts, or log activity with the + button."
                    : "Log activity with the + button."
                }
              />
            ) : null}
          </Section>
          <Section title="Movement and expenditure">
            <Text variant="subheadline">
              Movement is part of your total daily expenditure. Macros estimates
              that total from your food intake and weight trend over time.
            </Text>
            <Text variant="footnote" tone="secondary">
              Active energy from Health is shown for context. It isn’t added
              again to your calorie target or expenditure estimate, so it isn’t
              counted twice.
            </Text>
            <Text variant="headline">
              {expenditure.latestKcal === null
                ? "Your expenditure estimate is still building"
                : `Estimated daily total: ${formatEnergy(expenditure.latestKcal, energyUnit)} ${energyLabel(energyUnit)}`}
            </Text>
            <Row
              title="Expenditure details"
              subtitle="Intake and weight trend"
              chevron
              onPress={() => router.push("/progress/statistics")}
              separator={false}
            />
          </Section>
          <Section
            title="Daily readings"
            footer="Manual values override imported totals per measurement. Sources aren’t added together. A dash means no reading."
          >
            {[...days].reverse().map((day) => (
              <Row
                key={day.date}
                title={
                  day.date === today
                    ? "Today"
                    : format(parseISO(day.date), "EEE d MMM")
                }
                value={show(day[metric])}
                subtitle={
                  day[metric] === null
                    ? "No reading"
                    : (metric === "steps"
                          ? day.stepsSource
                          : day.energySource) === "manual"
                      ? "Manual"
                      : "Apple Health"
                }
              />
            ))}
          </Section>
          {Platform.OS === "ios" ? (
            <Section title="Sources">
              <Row
                title="Apple Health"
                subtitle="Import steps and active energy from your iPhone"
                chevron
                onPress={() => router.push("/more/apple-health")}
                separator={false}
              />
            </Section>
          ) : null}
        </VStack>
      </Screen>
    </>
  );
}
