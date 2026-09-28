import type { MacrosBodyMeasurementSite } from "@repo/schemas/macros";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  type BodyOverview,
  bodyKeys,
  useAddHydration,
  useBodyOverview,
} from "@/api/body";
import { useProfile } from "@/api/profile";
import {
  energyLabel,
  formatDecimal,
  formatEnergy,
  formatInteger,
  formatShortDate,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  Button,
  Flash,
  Row,
  Screen,
  Section,
  Stat,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { NoticeSlot, useNotice } from "../shared/notice";
import { useRefresh } from "../shared/use-refresh";
import { MEASUREMENT_SITES } from "./measurement-sites";
import { ProgressPhotos } from "./progress-photos";
import { Sparkline } from "./sparkline";

const ML_PER_OZ = 29.5735;

type Measurement = BodyOverview["measurements"][number];

interface SiteTrend {
  site: MacrosBodyMeasurementSite;
  label: string;
  latest: Measurement;
  values: number[];
  change: number;
  since: string;
}

function trendsBySite(measurements: readonly Measurement[]): SiteTrend[] {
  return MEASUREMENT_SITES.flatMap(({ value: site, label }) => {
    const all = measurements.filter((entry) => entry.site === site);
    const latest = all[all.length - 1];
    if (!latest) return [];
    const sameUnit = all.filter((entry) => entry.unit === latest.unit);
    const first = sameUnit[0] ?? latest;
    return [
      {
        site,
        label,
        latest,
        values: sameUnit.map((entry) => entry.value),
        change: latest.value - first.value,
        since: first.logDate,
      },
    ];
  });
}

function formatMeasurement(value: number, unit: string) {
  return unit === "%"
    ? `${formatDecimal(value)}%`
    : `${formatDecimal(value)} ${unit}`;
}

function formatChange(change: number, unit: string) {
  if (Math.abs(change) < 0.05) return "No change";
  const sign = change > 0 ? "+" : "−";
  return `${sign}${formatMeasurement(Math.abs(change), unit)}`;
}

export function BodyScreen() {
  const router = useRouter();
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const usesOunces = profile.data?.weightUnit === "lb";
  const overview = useBodyOverview();
  const queryClient = useQueryClient();
  const addHydration = useAddHydration();
  const { notice, show, showError, clear } = useNotice();
  const [waterFlash, setWaterFlash] = useState<number | null>(null);

  const refetch = useCallback(
    () =>
      Promise.all([
        overview.refetch(),
        queryClient.invalidateQueries({ queryKey: bodyKeys.photos }),
      ]),
    [overview, queryClient],
  );
  const { refreshing, onRefresh } = useRefresh(refetch);

  const data = overview.data;
  const today = data?.today;
  const trends = useMemo(() => trendsBySite(data?.measurements ?? []), [data]);

  const waterMl =
    data?.hydration.find((entry) => entry.logDate === today)?.volumeMl ?? 0;
  const todayActivity =
    data?.activity.filter((entry) => entry.logDate === today) ?? [];
  const activity =
    todayActivity.find((entry) => entry.source === "manual") ??
    todayActivity[0];
  const quickAdds = usesOunces ? [8, 12, 16] : [250, 350, 500];
  const volumeUnit = usesOunces ? "oz" : "ml";

  function drink(volume: number) {
    if (!today) return;
    haptics.light();
    setWaterFlash(Date.now());
    addHydration.mutate(
      { logDate: today, volume, unit: volumeUnit },
      { onError: showError },
    );
  }

  return (
    <Screen
      stickyHeaderIndices={[0]}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <NoticeSlot notice={notice} onDismiss={clear} />
      <VStack>
        <Section title="Water today">
          <View style={styles.block}>
            <Flash token={waterFlash}>
              <Stat
                size="large"
                label="Drunk"
                value={
                  usesOunces
                    ? formatDecimal(waterMl / ML_PER_OZ)
                    : formatInteger(waterMl)
                }
                unit={usesOunces ? "fl oz" : "ml"}
              />
            </Flash>
            <View style={styles.quickAdds}>
              {quickAdds.map((volume) => (
                <Button
                  key={volume}
                  label={`+${volume} ${usesOunces ? "oz" : "ml"}`}
                  variant="tinted"
                  size="small"
                  disabled={!today}
                  accessibilityLabel={`Add ${volume} ${usesOunces ? "fluid ounces" : "millilitres"} of water`}
                  onPress={() => drink(volume)}
                />
              ))}
            </View>
          </View>
        </Section>

        <Section
          title="Activity today"
          action={{
            label: "Edit",
            onPress: () => router.push("/more/activity"),
          }}
          footer="Context for your expenditure. Macros measures expenditure from what you eat and weigh, so steps are never added on top."
        >
          <View style={styles.stats}>
            <Stat
              label="Steps"
              value={
                activity?.steps !== null && activity?.steps !== undefined
                  ? formatInteger(activity.steps)
                  : "—"
              }
              style={styles.stat}
            />
            <Stat
              label="Active energy"
              value={
                activity?.activeEnergyKcal !== null &&
                activity?.activeEnergyKcal !== undefined
                  ? formatEnergy(activity.activeEnergyKcal, energyUnit)
                  : "—"
              }
              unit={energyLabel(energyUnit)}
              style={styles.stat}
            />
          </View>
          {activity?.source === "import" ? (
            <Text variant="footnote" tone="secondary" style={styles.source}>
              From Apple Health
            </Text>
          ) : null}
        </Section>

        <Section
          title="Measurements"
          action={{
            label: "Add",
            onPress: () => router.push("/more/measurement"),
          }}
        >
          {trends.length === 0 && data ? (
            <Text variant="subheadline" tone="secondary">
              Track your waist, hips and more. A tape measure often shows
              progress the scale hides.
            </Text>
          ) : null}
          {trends.map((trend, index) => (
            <Row
              key={trend.site}
              title={trend.label}
              subtitle={`${formatChange(trend.change, trend.latest.unit)} since ${formatShortDate(trend.since)}`}
              trailing={
                <View style={styles.trend}>
                  <Sparkline values={trend.values} />
                  <Text variant="body" figure>
                    {formatMeasurement(trend.latest.value, trend.latest.unit)}
                  </Text>
                </View>
              }
              separator={index < trends.length - 1}
              accessibilityHint="Adds a new measurement for this site"
              onPress={() =>
                router.push({
                  pathname: "/more/measurement",
                  params: { site: trend.site },
                })
              }
            />
          ))}
        </Section>

        <ProgressPhotos onError={showError} onNotice={show} />
      </VStack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.md,
  },
  quickAdds: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  stats: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  stat: {
    flex: 1,
  },
  source: {
    marginTop: spacing.sm,
  },
  trend: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
});
