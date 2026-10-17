import { colors, spacing, Text } from "@repo/native-ui";
import { StyleSheet, View } from "react-native";
import { longDay } from "@/lib/format";
import { useNow } from "@/lib/use-now";

const pad = (value: number) => String(value).padStart(2, "0");

/** The time, to the second, with the day under it. */
export function LiveClock() {
  const now = useNow(true);
  return (
    <View style={styles.clock} accessibilityRole="timer">
      <View style={styles.time}>
        <Text variant="largeTitle" style={styles.figure}>
          {pad(now.getHours())}:{pad(now.getMinutes())}
        </Text>
        <Text variant="title3" tone="tertiary" figure style={styles.seconds}>
          {pad(now.getSeconds())}
        </Text>
      </View>
      <Text variant="subheadline" tone="secondary">
        {longDay(now)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  clock: {
    alignItems: "center",
    gap: spacing.xxs,
    paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  time: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
  figure: { fontSize: 56, lineHeight: 64, fontVariant: ["tabular-nums"] },
  seconds: { minWidth: 28 },
});
