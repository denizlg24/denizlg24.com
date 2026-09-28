import { dateToIso, isoToDate } from "@repo/macros-core/food-log/date-utils";
import {
  addDays,
  endOfMonth,
  format,
  getDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useCalendarTotals } from "@/api/food-log";
import { useProfile } from "@/api/profile";
import { errorMessage } from "@/lib/api";
import { deviceTimeZone, useToday } from "@/lib/day";
import { type EnergyUnit, energyLabel, formatEnergy } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { colors, gutter, hairline, InlineNotice, spacing, Text } from "@/ui";
import { DayRing } from "./day-ring";
import { selectDate, useSelectedDate } from "./selected-date";

const MONTHS_SHOWN = 12;
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;

interface MonthProps {
  month: Date;
  today: string;
  selected: string;
  caloriesByDate: ReadonlyMap<string, number>;
  target: number | null;
  energyUnit: EnergyUnit;
  onOpen: (date: string) => void;
}

function MonthGrid({
  month,
  today,
  selected,
  caloriesByDate,
  target,
  energyUnit,
  onOpen,
}: MonthProps) {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const leading = (getDay(first) + 6) % 7;
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1))
    days.push(dateToIso(day));

  const logged = days
    .map((iso) => caloriesByDate.get(iso) ?? 0)
    .filter((calories) => calories > 0);
  const average =
    logged.length > 0
      ? logged.reduce((sum, value) => sum + value, 0) / logged.length
      : null;

  return (
    <View style={styles.month}>
      <View style={styles.monthHeader}>
        <Text variant="footnote" tone="secondary" eyebrow>
          {format(month, "MMMM yyyy")}
        </Text>
        <View style={styles.rule} />
        {average !== null ? (
          <Text variant="footnote" tone="secondary" figure>
            {`avg ${formatEnergy(average, energyUnit)} ${energyLabel(energyUnit)} · ${logged.length} ${logged.length === 1 ? "day" : "days"}`}
          </Text>
        ) : null}
      </View>
      <View style={styles.grid}>
        {Array.from({ length: leading }, (_, index) => (
          <View key={`blank-${index}`} style={styles.cell} />
        ))}
        {days.map((iso) => {
          const future = iso > today;
          const calories = caloriesByDate.get(iso) ?? 0;
          return (
            <Pressable
              key={iso}
              disabled={future}
              onPress={() => onOpen(iso)}
              style={styles.cell}
              accessibilityRole="button"
              accessibilityState={{
                selected: iso === selected,
                disabled: future,
              }}
              accessibilityLabel={`${format(isoToDate(iso), "EEEE d MMMM")}, ${formatEnergy(calories, energyUnit)} ${energyLabel(energyUnit)}`}
            >
              <DayRing
                day={Number(iso.slice(8))}
                progress={target && target > 0 ? calories / target : null}
                selected={iso === selected}
                today={iso === today}
                disabled={future}
                size={36}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A year of days, each ringed by its calories against target. */
export function CalendarScreen() {
  const router = useRouter();
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const today = useToday(profile.data?.timezone ?? deviceTimeZone());
  const selected = useSelectedDate(today);
  const [refreshing, setRefreshing] = useState(false);

  const months = useMemo(() => {
    const current = startOfMonth(isoToDate(today));
    return Array.from({ length: MONTHS_SHOWN }, (_, index) =>
      subMonths(current, index),
    );
  }, [today]);
  const start = dateToIso(months[months.length - 1] ?? isoToDate(today));
  const totals = useCalendarTotals(start, today);
  const caloriesByDate = useMemo(
    () =>
      new Map(totals.data?.days.map((day) => [day.date, day.calories]) ?? []),
    [totals.data],
  );
  const target = totals.data?.calorieTarget ?? null;

  function open(date: string) {
    haptics.selection();
    selectDate(date, today);
    if (router.canGoBack()) router.back();
    else router.replace("/log");
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await totals.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <FlatList
      data={months}
      keyExtractor={(month) => format(month, "yyyy-MM")}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.list}
      contentContainerStyle={styles.content}
      initialNumToRender={3}
      windowSize={5}
      stickyHeaderIndices={[0]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {totals.isError ? (
            <InlineNotice
              message={errorMessage(totals.error)}
              action={{
                label: "Try again",
                onPress: () => void totals.refetch(),
              }}
            />
          ) : null}
          <View style={styles.weekdays}>
            {WEEKDAYS.map((letter, index) => (
              <Text
                key={index}
                variant="caption2"
                weight="semibold"
                tone="tertiary"
                align="center"
                style={styles.cell}
              >
                {letter}
              </Text>
            ))}
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <MonthGrid
          month={item}
          today={today}
          selected={selected}
          caloriesByDate={caloriesByDate}
          target={target}
          energyUnit={energyUnit}
          onOpen={open}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: gutter,
    paddingBottom: spacing.xxxl,
  },
  header: {
    backgroundColor: colors.background,
    paddingBottom: spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.separator,
  },
  weekdays: {
    flexDirection: "row",
    paddingTop: spacing.sm,
  },
  month: {
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rule: {
    flex: 1,
    height: hairline,
    backgroundColor: colors.separator,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.sm,
  },
  cell: {
    width: `${100 / 7}%`,
    alignItems: "center",
  },
});
