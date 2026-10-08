import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useClock, useOverview } from "@/api/hours";
import { haptics } from "@/lib/haptics";
import { localDay, localTime } from "@/lib/time";
import { Button, colors, Notice, spacing, Text, WheelTimePicker } from "@/ui";

type ClockAction = "in" | "out" | "break" | "resume";

const LABEL: Record<ClockAction, string> = {
  in: "Check in",
  out: "Check out",
  break: "Break",
  resume: "Resume",
};

const AGO_MINUTES = [5, 15, 30, 60];

/** Clocking after the fact: the door was forgotten, the bus remembers. */
export function EarlierSheet() {
  const overview = useOverview();
  const clock = useClock();
  const active = overview.data?.active ?? null;
  const openBreak = active?.breaks.find((item) => !item.end);
  const actions: ClockAction[] = active
    ? openBreak
      ? ["resume", "out"]
      : ["break", "out"]
    : ["in"];
  const [action, setAction] = useState<ClockAction>(
    active ? (openBreak ? "resume" : "out") : "in",
  );
  const [time, setTime] = useState(() => new Date());

  // A time later than now meant yesterday evening.
  const at = useMemo(() => {
    const value = new Date();
    value.setHours(time.getHours(), time.getMinutes(), 0, 0);
    if (value > new Date()) value.setDate(value.getDate() - 1);
    return value;
  }, [time]);
  const minutesAgo = Math.round((Date.now() - at.getTime()) / 60_000);
  const yesterday = localDay(at) !== localDay(new Date());

  return (
    <View style={styles.sheet}>
      {actions.length > 1 ? (
        <View style={styles.segments}>
          {actions.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: action === value }}
              onPress={() => {
                haptics.selection();
                setAction(value);
              }}
              style={[styles.segment, action === value && styles.segmentOn]}
            >
              <Text
                variant="subheadline"
                weight="semibold"
                tone={action === value ? "primary" : "secondary"}
              >
                {LABEL[value]}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ alignItems: "center" }}>
        <WheelTimePicker value={time} onChange={setTime} />
      </View>
      <View style={styles.chips}>
        {AGO_MINUTES.map((minutes) => (
          <Pressable
            key={minutes}
            accessibilityRole="button"
            onPress={() => {
              haptics.selection();
              setTime(new Date(Date.now() - minutes * 60_000));
            }}
            style={[styles.chip, minutesAgo === minutes && styles.chipOn]}
          >
            <Text
              variant="subheadline"
              figure
              tone={minutesAgo === minutes ? "onTint" : "primary"}
            >
              −{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
            </Text>
          </Pressable>
        ))}
      </View>
      {clock.error ? <Notice message={clock.error.message} /> : null}
      <Button
        label={`${LABEL[action]} at ${localTime(at)}${yesterday ? " yesterday" : ""}`}
        loading={clock.isPending}
        onPress={() =>
          clock.mutate(
            { action, at: at.toISOString() },
            {
              onSuccess: () => {
                haptics.success();
                router.back();
              },
              onError: () => haptics.error(),
            },
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: spacing.xl, paddingTop: spacing.xxl, gap: spacing.xl },
  segments: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: 10,
    backgroundColor: colors.tertiaryFill,
  },
  segment: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentOn: { backgroundColor: colors.background },
  chips: { flexDirection: "row", gap: spacing.sm },
  chip: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tertiaryFill,
  },
  chipOn: { backgroundColor: colors.tint },
});
