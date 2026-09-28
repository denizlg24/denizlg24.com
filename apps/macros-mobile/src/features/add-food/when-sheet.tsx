import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentMinute } from "@/lib/day";
import { formatDayLabel } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  eatenAtFor,
  followsClock,
  latestLogInstant,
  pinnedAt,
} from "@/lib/log-time";
import { Button, colors, gutter, spacing } from "@/ui";
import { SheetHeader } from "../today/sheet-header";
import { hubTime, useHubTime } from "./hub-time";
import { useZone } from "./target";

/** The hub's time chip: the day and time everything added from it lands at. */
export function WhenSheet() {
  const insets = useSafeAreaInsets();
  const zone = useZone();
  const when = useHubTime(zone.today);
  const following = followsClock(when, zone.today);
  const now = useCurrentMinute(when.clock === null);

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, spacing.lg) },
      ]}
    >
      <SheetHeader
        title="When"
        subtitle={formatDayLabel(when.date, zone.today)}
        onClose={() => router.back()}
      />
      <DateTimePicker
        value={eatenAtFor(when, zone.timeZone, now)}
        mode="datetime"
        display="spinner"
        timeZoneName={zone.timeZone}
        maximumDate={latestLogInstant(zone.today, zone.timeZone)}
        onValueChange={(_event, next) => {
          haptics.selection();
          hubTime.set(pinnedAt(next, zone.timeZone));
        }}
      />
      <View style={styles.actions}>
        <Button
          label="Now"
          variant="tinted"
          size="regular"
          disabled={following}
          onPress={() => {
            haptics.selection();
            hubTime.set(null);
            router.back();
          }}
          style={styles.action}
        />
        <Button
          label="Done"
          size="regular"
          onPress={() => router.back()}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
    paddingHorizontal: gutter,
    paddingTop: spacing.xl,
    backgroundColor: colors.background,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
  },
  action: {
    flex: 1,
  },
});
