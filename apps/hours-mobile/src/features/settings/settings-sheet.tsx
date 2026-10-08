import { HoursNative } from "@modules/hours-native";
import { formatMinutes } from "@repo/utils";
import { router } from "expo-router";
import {
  ActionSheetIOS,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { signOut } from "@/lib/auth";
import { haptics } from "@/lib/haptics";
import { Button, colors, Hairline, Row, Section, spacing, Text } from "@/ui";
import type { ReminderSettings } from "../reminders/plan";
import {
  setReminderSettings,
  useReminderSettings,
} from "../reminders/settings";

function choose<T extends number>(
  title: string,
  options: readonly T[],
  label: (value: T) => string,
  onPick: (value: T) => void,
) {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title,
      options: [...options.map(label), "Cancel"],
      cancelButtonIndex: options.length,
    },
    (index) => {
      const value = options[index];
      if (value === undefined) return;
      haptics.selection();
      onPick(value);
    },
  );
}

const hours = (value: number) =>
  value === 0 ? "Off" : `${formatMinutes(value * 60)} h`;
const minutes = (value: number) => (value === 0 ? "Off" : `${value} min`);

export function SettingsSheet() {
  const settings = useReminderSettings();
  const activities = HoursNative?.activitiesEnabled() ?? false;
  const set = (patch: Partial<ReminderSettings>) => setReminderSettings(patch);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Section title="Reminders">
        <Row
          title="Still checked in"
          value={hours(settings.longShiftHours)}
          chevron
          onPress={() =>
            choose("After", [0, 8, 9, 10, 11, 12] as const, hours, (value) =>
              set({ longShiftHours: value }),
            )
          }
        />
        <Row
          title="Break due"
          value={hours(settings.breakAfterHours)}
          chevron
          onPress={() =>
            choose(
              "After working",
              [0, 4, 5, 5.5, 6] as const,
              hours,
              (value) => set({ breakAfterHours: value }),
            )
          }
        />
        <Row
          title="Break over"
          value={minutes(settings.breakLengthMinutes)}
          chevron
          onPress={() =>
            choose("After", [0, 15, 30, 45, 60] as const, minutes, (value) =>
              set({ breakLengthMinutes: value }),
            )
          }
        />
        <ToggleRow
          title="Weekly target"
          value={settings.weeklyTarget}
          onChange={(value) => set({ weeklyTarget: value })}
        />
        <ToggleRow
          title="Payday"
          value={settings.payday}
          onChange={(value) => set({ payday: value })}
          separator={false}
        />
      </Section>

      <Section title="Lock Screen">
        <Row
          title="Live Activities"
          value={activities ? "On" : "Off"}
          chevron={!activities}
          separator={false}
          onPress={activities ? undefined : () => void Linking.openSettings()}
        />
      </Section>

      <Button
        label="Sign out"
        variant="destructive"
        onPress={() => {
          haptics.warning();
          router.back();
          void signOut();
        }}
      />
    </ScrollView>
  );
}

function ToggleRow({
  title,
  value,
  onChange,
  separator = true,
}: {
  title: string;
  value: boolean;
  onChange: (value: boolean) => void;
  separator?: boolean;
}) {
  return (
    <View>
      <View style={styles.toggle}>
        <Text variant="body">{title}</Text>
        <Switch
          value={value}
          trackColor={{ true: colors.working }}
          onValueChange={(next) => {
            haptics.selection();
            onChange(next);
          }}
        />
      </View>
      {separator ? <Hairline /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.xxl },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
  },
});
