import type { MacrosCaloriePreference } from "@repo/schemas/macros";
import { format, parseISO } from "date-fns";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useBodyOverview } from "@/api/body";
import { useDashboard } from "@/api/dashboard";
import { useProfile, useUpdateCaloriePreference } from "@/api/profile";
import { useWeightOverview } from "@/api/weight";
import { FailedWritesNotice } from "@/components/failed-writes-notice";
import { PendingPlateBar } from "@/features/add-food/components/plate-bar";
import { errorMessage, NetworkError } from "@/lib/api";
import { useToday } from "@/lib/day";
import { haptics } from "@/lib/haptics";
import {
  Button,
  Flash,
  HeaderIconButton,
  InlineNotice,
  PageHeader,
  Screen,
  Section,
  spacing,
  VStack,
} from "@/ui";
import { EnergySection } from "./energy-section";
import { HabitsSection } from "./habits-section";
import { weighInHref } from "./links";
import { NutritionSummary } from "./nutrition-summary";
import { PendingSyncNotice } from "./pending-sync-notice";
import { StreaksSection } from "./streaks-section";
import { WeightSection } from "./weight-section";

function useCaloriePreference(saved: MacrosCaloriePreference) {
  const update = useUpdateCaloriePreference();
  const [pending, setPending] = useState<MacrosCaloriePreference | null>(null);
  const [failed, setFailed] = useState(false);

  function change(next: MacrosCaloriePreference) {
    if (next === (pending ?? saved)) return;
    haptics.selection();
    setPending(next);
    setFailed(false);
    update.mutate(next, {
      onError: () => {
        haptics.error();
        setFailed(true);
      },
      onSettled: () => setPending(null),
    });
  }

  return {
    mode: pending ?? saved,
    change,
    failed,
    dismissFailure: () => setFailed(false),
  };
}

export function TodayScreen() {
  const router = useRouter();
  const profile = useProfile();
  const timeZone = profile.data?.timezone;
  const day = useToday(timeZone);
  const dashboard = useDashboard(day);
  const weight = useWeightOverview();
  const body = useBodyOverview();
  const [refreshing, setRefreshing] = useState(false);

  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const weightUnit = profile.data?.weightUnit ?? "kg";
  const preference = useCaloriePreference(
    profile.data?.caloriePreference ??
      dashboard.data?.caloriePreference ??
      "remaining",
  );

  async function refresh() {
    setRefreshing(true);
    await Promise.all([dashboard.refetch(), weight.refetch(), body.refetch()]);
    setRefreshing(false);
  }

  const openLog = () => router.push("/log");
  const openProgress = () => router.push("/progress");
  const openMore = () => router.push("/more");
  const openHabits = () => router.push("/more/habits");
  const headerButtons = (
    <>
      <HeaderIconButton
        icon="droplet"
        label="Water"
        onPress={() => router.push("/water")}
      />
      <HeaderIconButton
        icon="target"
        label="Strategy"
        onPress={() => router.push("/strategy")}
      />
    </>
  );

  const data = dashboard.data;
  const dateLine = format(parseISO(data?.today ?? day), "EEEE d MMMM");

  if (!data) {
    return (
      <Screen statusBarScrim>
        <PageHeader title="Today" subtitle={dateLine}>
          {headerButtons}
        </PageHeader>
        {dashboard.fetchStatus === "paused" ? (
          <View style={styles.firstLoad}>
            <InlineNotice
              tone="offline"
              message="You’re offline. Today loads as soon as you’re back."
            />
          </View>
        ) : dashboard.isError ? (
          <View style={styles.firstLoad}>
            <InlineNotice
              tone={
                dashboard.error instanceof NetworkError ? "offline" : "error"
              }
              message={errorMessage(dashboard.error)}
            />
            <Button
              label="Try again"
              variant="tinted"
              onPress={() => void dashboard.refetch()}
            />
          </View>
        ) : (
          <View style={styles.firstLoad}>
            <ActivityIndicator />
          </View>
        )}
      </Screen>
    );
  }

  const stale = dashboard.isError;

  return (
    <Screen
      statusBarScrim
      onRefresh={() => void refresh()}
      refreshing={refreshing}
    >
      <VStack>
        <View style={styles.top}>
          <PageHeader title="Today" subtitle={dateLine}>
            {headerButtons}
          </PageHeader>
          {stale ? (
            <InlineNotice
              tone={
                dashboard.error instanceof NetworkError ? "offline" : "error"
              }
              message={
                dashboard.error instanceof NetworkError
                  ? "Offline — showing what was saved on this phone."
                  : `Couldn’t refresh. ${errorMessage(dashboard.error)}`
              }
              action={{
                label: "Retry",
                onPress: () => void dashboard.refetch(),
              }}
            />
          ) : null}
          <PendingSyncNotice />
          <FailedWritesNotice />
          <PendingPlateBar />
        </View>

        <Section
          title="Nutrition"
          action={{ label: "Food log", onPress: openLog }}
        >
          <Flash key={day} token={Math.round(data.consumed.calories)}>
            <NutritionSummary
              consumed={data.consumed}
              targets={data.targets}
              mode={preference.mode}
              energyUnit={energyUnit}
              onModeChange={preference.change}
              onOpenLog={openLog}
            />
          </Flash>
          {preference.failed ? (
            <InlineNotice
              message="Couldn’t save which figure the ring shows."
              onDismiss={preference.dismissFailure}
            />
          ) : null}
          {data.targets.calories === null ? (
            <InlineNotice
              tone="info"
              message="No nutrition plan is active, so there’s no target yet."
              action={{ label: "Set up", onPress: openMore }}
            />
          ) : null}
        </Section>

        <HabitsSection
          habits={data.habits}
          logDate={data.today}
          onManage={openHabits}
        />

        <EnergySection
          energyBalance={data.energyBalance}
          goalProgress={data.goalProgress}
          hasPlan={data.targets.calories !== null}
          energyUnit={energyUnit}
          today={data.today}
          onOpen={openProgress}
        />

        <WeightSection
          summary={data.weightSummary}
          trend={weight.data?.trend}
          unit={weightUnit}
          today={data.today}
          onOpen={openProgress}
          onWeighIn={() => router.push(weighInHref())}
        />

        <StreaksSection
          foodLogging={data.foodLoggingSummary}
          weight={data.weightSummary}
          today={data.today}
          onOpenLog={openLog}
          onOpenProgress={openProgress}
        />
      </VStack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    gap: spacing.xs,
    marginBottom: -spacing.md,
  },
  firstLoad: {
    gap: spacing.lg,
    paddingVertical: spacing.xxxl,
    alignItems: "stretch",
  },
});
