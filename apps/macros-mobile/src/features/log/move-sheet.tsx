import { dateToIso, isoToDate } from "@repo/macros-core/food-log/date-utils";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFoodLogDay, usePlaceEntries } from "@/api/food-log";
import { useProfile } from "@/api/profile";
import { errorMessage } from "@/lib/api";
import { deviceTimeZone, useToday } from "@/lib/day";
import { haptics } from "@/lib/haptics";
import { clockOf, eatenAtFor, formatTimeOfDay } from "@/lib/log-time";
import {
  colors,
  Hairline,
  Icon,
  InlineNotice,
  Section,
  sheetGutter,
  spacing,
  Text,
} from "@/ui";
import { DateTimePicker } from "@/ui/date-time-picker";
import { flashEntries } from "./flash";
import { isIsoDate } from "./selected-date";
import { stopSelecting } from "./selection";
import { SheetHeader } from "./sheet-header";

const AFTER_DISMISS_MS = 420;

/** Moves entries to another day, another time, or both. */
export function MoveSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; ids?: string }>();
  const profile = useProfile();
  const timeZone = profile.data?.timezone ?? deviceTimeZone();
  const today = useToday(timeZone);
  const date = isIsoDate(params.date) ? params.date : today;
  const requested = new Set((params.ids ?? "").split(",").filter(Boolean));

  const day = useFoodLogDay(date);
  const place = usePlaceEntries();
  const [targetDate, setTargetDate] = useState(date);
  // Null keeps each entry's own time of day.
  const [clock, setClock] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = (day.data?.entries ?? []).filter((entry) =>
    requested.has(entry.id),
  );
  const count = selected.length;
  const first = selected[0];
  const seedClock = clockOf(
    first?.eatenAt ? new Date(first.eatenAt) : new Date(),
    timeZone,
  );
  const shownClock = clock ?? seedClock;
  const shownTime = eatenAtFor(
    { date: targetDate, clock: shownClock },
    timeZone,
  );
  const nothingChanges = clock === null && targetDate === date;
  const latest = targetDate > today ? targetDate : today;

  function chooseClock(next: string | null) {
    haptics.selection();
    setClock(next);
  }

  function submit() {
    setNotice(null);
    const ids = selected.map((entry) => entry.id);
    place.mutate(
      {
        entryIds: ids,
        ...(targetDate !== date ? { logDate: targetDate } : {}),
        ...(clock !== null ? { eatenAt: shownTime.toISOString() } : {}),
      },
      {
        onSuccess: () => {
          haptics.success();
          stopSelecting();
          if (targetDate === date) flashEntries(ids, AFTER_DISMISS_MS);
          router.back();
        },
        onError: (error) => {
          haptics.error();
          setNotice(errorMessage(error));
        },
      },
    );
  }

  const keepLabel =
    count === 1
      ? first?.eatenAt
        ? `Keep ${formatTimeOfDay(first.eatenAt, timeZone)}`
        : "Keep its time"
      : "Keep each entry’s time";

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title={count === 1 ? "Move entry" : `Move ${count} entries`}
        onCancel={() => router.back()}
        confirm={{
          label: "Move",
          onPress: submit,
          disabled: count === 0 || nothingChanges,
          busy: place.isPending,
        }}
      />
      {notice ? (
        <InlineNotice
          message={notice}
          onDismiss={() => setNotice(null)}
          style={styles.notice}
        />
      ) : null}

      <View style={styles.content}>
        <Section title="Day">
          <View style={styles.row}>
            <Text variant="body">Log on</Text>
            <DateTimePicker
              value={isoToDate(targetDate)}
              mode="date"
              display="compact"
              maximumDate={isoToDate(latest)}
              onValueChange={(_event, next) => {
                haptics.selection();
                setTargetDate(dateToIso(next));
              }}
              style={styles.picker}
            />
          </View>
        </Section>

        <Section title="Time">
          <Pressable
            onPress={() => chooseClock(null)}
            accessibilityRole="radio"
            accessibilityState={{ checked: clock === null }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text variant="body" style={styles.fill}>
              {keepLabel}
            </Text>
            {clock === null ? <Checkmark /> : null}
          </Pressable>
          <Hairline />
          <View style={styles.row}>
            <Pressable
              onPress={() => chooseClock(shownClock)}
              accessibilityRole="radio"
              accessibilityState={{ checked: clock !== null }}
              accessibilityLabel="Set a time"
              hitSlop={8}
              style={styles.label}
            >
              <Text variant="body">At</Text>
            </Pressable>
            <DateTimePicker
              value={shownTime}
              mode="time"
              display="compact"
              timeZoneName={timeZone}
              onValueChange={(_event, next) =>
                chooseClock(clockOf(next, timeZone))
              }
              style={styles.picker}
            />
            {clock !== null ? <Checkmark /> : <View style={styles.check} />}
          </View>
        </Section>
      </View>
    </View>
  );
}

function Checkmark() {
  return (
    <View style={styles.check}>
      <Icon name="check" size={17} weight="semibold" color={colors.label} />
    </View>
  );
}

const styles = StyleSheet.create({
  // A fit-to-contents sheet sizes to this view, so nothing here may flex.
  sheet: {
    backgroundColor: colors.background,
  },
  notice: {
    paddingHorizontal: sheetGutter,
  },
  content: {
    paddingHorizontal: sheetGutter,
    paddingBottom: spacing.xxxl,
    gap: spacing.xxl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.fill,
  },
  label: {
    flexShrink: 1,
  },
  fill: {
    flex: 1,
  },
  picker: {
    flex: 1,
  },
  check: {
    width: 20,
    alignItems: "flex-end",
  },
});
