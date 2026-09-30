import { DateTimePicker as SystemPicker } from "@expo/ui/community/datetime-picker";
import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { getCalendars } from "expo-localization";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type * as Shared from "./date-time-picker";
import { Text } from "./text";
import { colors, radius, spacing, useResolvedColors } from "./theme";

export type {
  CompactTimePickerProps,
  DateTimePickerProps,
} from "./date-time-picker";

type Phase = "date" | "time" | null;

const uses24Hour = () => getCalendars()[0]?.uses24hourClock ?? false;

/**
 * The inline iOS picker as a field that opens Material's date and time
 * dialogs, one after the other for `datetime`. The dialogs read the device's
 * clock, so a `timeZoneName` is honoured by shifting into that zone's wall
 * clock on the way in and back out on the way out.
 */
export const DateTimePicker: typeof Shared.DateTimePicker = ({
  value,
  mode = "date",
  minimumDate,
  maximumDate,
  timeZoneName,
  accentColor,
  onValueChange,
  onChange,
  style,
  testID,
}) => {
  const resolved = useResolvedColors();
  const [phase, setPhase] = useState<Phase>(null);
  const [draft, setDraft] = useState<Date | null>(null);
  const is24Hour = uses24Hour();

  const toWall = (date: Date) =>
    timeZoneName ? toZonedTime(date, timeZoneName) : date;
  const fromWall = (date: Date) =>
    timeZoneName ? fromZonedTime(date, timeZoneName) : date;

  const wall = toWall(value);
  const wallMin = minimumDate ? toWall(minimumDate) : undefined;
  const wallMax = maximumDate ? toWall(maximumDate) : undefined;

  function commit(nextWall: Date) {
    let next = fromWall(nextWall);
    if (maximumDate && next > maximumDate) next = maximumDate;
    if (minimumDate && next < minimumDate) next = minimumDate;
    const event = {
      nativeEvent: {
        timestamp: next.getTime(),
        utcOffset: -next.getTimezoneOffset(),
      },
    };
    if (onValueChange) onValueChange(event, next);
    else onChange?.({ type: "set", ...event }, next);
  }

  function pickedDate(picked: Date) {
    // Material's date dialog answers with UTC midnight of the chosen day.
    const next = new Date(draft ?? wall);
    next.setFullYear(
      picked.getUTCFullYear(),
      picked.getUTCMonth(),
      picked.getUTCDate(),
    );
    if (mode === "datetime") {
      setDraft(next);
      setPhase("time");
      return;
    }
    setPhase(null);
    commit(next);
  }

  function pickedTime(picked: Date) {
    const next = new Date(draft ?? wall);
    next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    setPhase(null);
    setDraft(null);
    commit(next);
  }

  function dismiss() {
    setPhase(null);
    setDraft(null);
  }

  const timeLabel = format(wall, is24Hour ? "HH:mm" : "h:mm a");
  const dateLabel = format(wall, "d MMM yyyy");

  return (
    <View style={[styles.row, style]} testID={testID}>
      {mode !== "time" ? (
        <Field
          label={dateLabel}
          onPress={() => setPhase("date")}
          accessibilityLabel={`Date, ${dateLabel}`}
        />
      ) : null}
      {mode !== "date" ? (
        <Field
          label={timeLabel}
          onPress={() => {
            setDraft(wall);
            setPhase("time");
          }}
          accessibilityLabel={`Time, ${timeLabel}`}
        />
      ) : null}
      {phase === "date" ? (
        <SystemPicker
          value={draft ?? wall}
          mode="date"
          presentation="dialog"
          minimumDate={wallMin}
          maximumDate={wallMax}
          accentColor={accentColor ?? resolved.label}
          onValueChange={(_event, picked) => pickedDate(picked)}
          onDismiss={dismiss}
        />
      ) : null}
      {phase === "time" ? (
        <SystemPicker
          value={draft ?? wall}
          mode="time"
          presentation="dialog"
          is24Hour={is24Hour}
          accentColor={accentColor ?? resolved.label}
          onValueChange={(_event, picked) => pickedTime(picked)}
          onDismiss={dismiss}
        />
      ) : null}
    </View>
  );
};

function Field({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.field, pressed && styles.pressed]}
    >
      <Text variant="body" figure>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  field: {
    backgroundColor: colors.tertiaryFill,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  pressed: {
    opacity: 0.6,
  },
});

/** The same field, time only; Android has no compact pill to size. */
export const CompactTimePicker: typeof Shared.CompactTimePicker = ({
  value,
  onValueChange,
  accentColor,
  style,
}) => (
  <DateTimePicker
    value={value}
    mode="time"
    accentColor={accentColor}
    onValueChange={(_event, date) => onValueChange(date)}
    style={style}
  />
);
