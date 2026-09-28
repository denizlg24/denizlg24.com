import type {
  MacrosFoodLogActivityDay,
  MacrosFoodLogActivityOverview,
  MacrosFoodLogDayStatus,
} from "@repo/schemas/macros";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useFoodLogActivity } from "@/api/food-log";
import { errorMessage } from "@/lib/api";
import { shiftIsoDate } from "@/lib/day";
import { haptics } from "@/lib/haptics";
import {
  colors,
  gutter,
  InlineNotice,
  radius,
  Screen,
  Section,
  Stat,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { selectDate } from "./selected-date";
import { YearHeatmap } from "./year-heatmap";

/**
 * Consecutive logged days ending today — or yesterday, while today has
 * nothing yet, so a streak is not reported broken before the day is over.
 */
function currentStreak(
  days: readonly MacrosFoodLogActivityDay[],
  today: string,
) {
  const statusByDate = new Map(days.map((day) => [day.date, day.status]));
  const logged = (iso: string) => {
    const status = statusByDate.get(iso);
    return status !== undefined && status !== "empty";
  };
  let cursor = logged(today) ? today : shiftIsoDate(today, -1);
  let streak = 0;
  while (logged(cursor)) {
    streak += 1;
    cursor = shiftIsoDate(cursor, -1);
  }
  return streak;
}

function plural(count: number, noun: string) {
  return count === 1 ? noun : `${noun}s`;
}

function LegendSwatch({
  status,
  label,
}: {
  status: MacrosFoodLogDayStatus;
  label: string;
}) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.swatch,
          status === "empty"
            ? { backgroundColor: colors.fill }
            : {
                backgroundColor: colors.label,
                opacity: status === "partial" ? 0.35 : 1,
              },
        ]}
      />
      <Text variant="caption1" tone="secondary">
        {label}
      </Text>
    </View>
  );
}

function ActivityBody({
  data,
  width,
  onSelectDay,
}: {
  data: MacrosFoodLogActivityOverview;
  width: number;
  onSelectDay: (date: string) => void;
}) {
  const streak = currentStreak(data.days, data.today);
  const logged30 = data.summary.last30Days.filter(
    (day) => day.status !== "empty",
  ).length;
  const statusByDate = new Map(data.days.map((day) => [day.date, day.status]));
  const currentYear = Number(data.today.slice(0, 4));
  const years = [...new Set([currentYear, ...data.years])].sort(
    (a, b) => b - a,
  );
  const { fullThisWeek, partialThisWeek } = data.summary;

  return (
    <VStack>
      <View style={styles.stats}>
        <Stat
          label="Streak"
          value={String(streak)}
          unit={plural(streak, "day")}
          size="large"
          style={styles.stat}
        />
        <Stat
          label="This week"
          value={String(fullThisWeek)}
          unit="/ 7"
          detail={
            partialThisWeek > 0 ? `+${partialThisWeek} partial` : undefined
          }
          size="large"
          style={styles.stat}
        />
        <Stat
          label="30 days"
          value={String(logged30)}
          unit="/ 30"
          size="large"
          style={styles.stat}
        />
      </View>

      <View style={styles.legend}>
        <LegendSwatch status="full" label="Tracked" />
        <LegendSwatch status="partial" label="Partial" />
        <LegendSwatch status="empty" label="Not tracked" />
      </View>

      {years.map((year) => (
        <Section key={year} title={String(year)}>
          <YearHeatmap
            year={year}
            width={width - gutter * 2}
            today={data.today}
            statusByDate={statusByDate}
            onSelectDay={onSelectDay}
          />
        </Section>
      ))}
    </VStack>
  );
}

/** How consistently food has been logged: streak, this week, the year. */
export function ActivityScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const activity = useFoodLogActivity();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await activity.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  function openDay(date: string) {
    const today = activity.data?.today;
    if (!today) return;
    haptics.selection();
    selectDate(date, today);
    if (router.canGoBack()) router.back();
    else router.replace("/log");
  }

  const data = activity.data;

  return (
    <Screen onRefresh={() => void refresh()} refreshing={refreshing}>
      {activity.isError && !data ? (
        <InlineNotice
          message={errorMessage(activity.error)}
          action={{
            label: "Try again",
            onPress: () => void activity.refetch(),
          }}
        />
      ) : null}

      {data ? (
        <ActivityBody data={data} width={width} onSelectDay={openDay} />
      ) : activity.isPending ? (
        <ActivityIndicator style={styles.loading} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  stat: {
    flex: 1,
  },
  legend: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: radius.sm / 4,
  },
  loading: {
    paddingVertical: spacing.xxxl,
  },
});
