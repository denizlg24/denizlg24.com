import { StyleSheet, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { Hairline, spacing, Text, useResolvedColors } from "@/ui";
import { CompactTimePicker } from "@/ui/date-time-picker";

function timeValue(hour: number, minute: number): Date {
  return new Date(2000, 0, 1, hour, minute);
}

/**
 * A reminder's time as the native compact pill at the row's trailing edge.
 * Sized to its content: the community picker has no intrinsic width, and in
 * `Row`'s trailing slot it collapsed to nothing and could not be tapped.
 */
export function ReminderTimeRow({
  title = "Time",
  hour,
  minute,
  onChange,
  separator = true,
}: {
  title?: string;
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
  separator?: boolean;
}) {
  const resolved = useResolvedColors();
  return (
    <View>
      <View style={styles.row}>
        <Text variant="body">{title}</Text>
        <CompactTimePicker
          value={timeValue(hour, minute)}
          accentColor={resolved.label}
          onValueChange={(date) => {
            if (date.getHours() === hour && date.getMinutes() === minute) {
              return;
            }
            haptics.selection();
            onChange(date.getHours(), date.getMinutes());
          }}
        />
      </View>
      {separator ? <Hairline /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: spacing.xs,
  },
});
