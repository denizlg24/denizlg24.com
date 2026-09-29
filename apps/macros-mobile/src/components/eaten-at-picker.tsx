import { Pressable, StyleSheet, View } from "react-native";
import { useCurrentMinute } from "@/lib/day";
import { haptics } from "@/lib/haptics";
import {
  eatenAtFor,
  followsClock,
  type LogTime,
  latestLogInstant,
  pinnedAt,
} from "@/lib/log-time";
import { spacing, Text } from "@/ui";
import { DateTimePicker } from "@/ui/date-time-picker";

export interface EatenAtPickerProps {
  value: LogTime;
  timeZone: string;
  today: string;
  onChange: (next: LogTime) => void;
}

/**
 * The day and time a log lands at, as the native compact picker. "Now" hands
 * the choice back to the clock; it stays in place, disabled, while the clock
 * already decides, so the pickers never shift under a finger.
 */
export function EatenAtPicker({
  value,
  timeZone,
  today,
  onChange,
}: EatenAtPickerProps) {
  const now = useCurrentMinute(value.clock === null);
  const following = followsClock(value, today);

  return (
    <View style={styles.row}>
      <Text variant="body">Eaten</Text>
      <DateTimePicker
        value={eatenAtFor(value, timeZone, now)}
        mode="datetime"
        display="compact"
        timeZoneName={timeZone}
        maximumDate={latestLogInstant(today, timeZone)}
        onValueChange={(_event, next) => {
          haptics.selection();
          onChange(pinnedAt(next, timeZone));
        }}
        style={styles.picker}
      />
      <Pressable
        onPress={() => {
          haptics.selection();
          onChange({ date: today, clock: null });
        }}
        disabled={following}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Use the current time"
        accessibilityState={{ disabled: following }}
      >
        <Text
          variant="subheadline"
          weight="semibold"
          tone={following ? "tertiary" : "primary"}
        >
          Now
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
  },
  picker: {
    flex: 1,
  },
});
