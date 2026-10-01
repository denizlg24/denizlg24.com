import type { MacrosFoodLogEntry } from "@repo/schemas/macros";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import { clockOf, eatenAtFor, formatTimeOfDay } from "@/lib/log-time";
import { colors, radius, spacing, Text } from "@/ui";
import {
  clockOfMinutes,
  formatShift,
  minutesOfClock,
  retimedMinutes,
} from "./retime";

const NUDGE_LIMIT = 28;
const NOON = 12 * 60;

export interface RetimeDragProps {
  entry: MacrosFoodLogEntry;
  timezone: string;
  onRetime: (entry: MacrosFoodLogEntry, eatenAt: string) => void;
  onActiveChange: (active: boolean) => void;
  children: ReactNode;
}

/**
 * Drag a row to the right to pick it up, then up or down to move it through
 * the day. Swiping left stays the row's actions.
 */
export function RetimeDrag({
  entry,
  timezone,
  onRetime,
  onActiveChange,
  children,
}: RetimeDragProps) {
  const base = entry.eatenAt
    ? minutesOfClock(clockOf(new Date(entry.eatenAt), timezone))
    : NOON;
  const [target, setTarget] = useState<number | null>(null);
  const nudge = useSharedValue(0);

  const latest = useRef({ entry, timezone, base, onRetime, onActiveChange });
  latest.current = { entry, timezone, base, onRetime, onActiveChange };
  const picked = useRef<number | null>(null);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX(14)
        .failOffsetX(-8)
        .failOffsetY([-12, 12])
        .onStart(() => {
          picked.current = latest.current.base;
          setTarget(latest.current.base);
          latest.current.onActiveChange(true);
          haptics.impact();
        })
        .onUpdate((event) => {
          nudge.value = Math.min(NUDGE_LIMIT, event.translationX * 0.3);
          const next = retimedMinutes(latest.current.base, event.translationY);
          if (next !== picked.current) {
            picked.current = next;
            setTarget(next);
            haptics.selection();
          }
        })
        .onEnd(() => {
          const { entry, timezone, base, onRetime } = latest.current;
          const next = picked.current;
          if (next === null || next === base) return;
          onRetime(
            entry,
            eatenAtFor(
              { date: entry.logDate, clock: clockOfMinutes(next) },
              timezone,
            ).toISOString(),
          );
        })
        .onFinalize(() => {
          nudge.value = withSpring(0, { damping: 18, stiffness: 220 });
          if (picked.current !== null) latest.current.onActiveChange(false);
          picked.current = null;
          setTarget(null);
        }),
    [nudge],
  );

  const nudgeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: nudge.value }],
  }));

  const active = target !== null;
  const label = active
    ? formatTimeOfDay(
        eatenAtFor(
          { date: entry.logDate, clock: clockOfMinutes(target) },
          timezone,
        ),
        timezone,
      )
    : null;

  return (
    <GestureDetector gesture={gesture}>
      <View style={active && styles.lifted}>
        <Animated.View style={nudgeStyle}>{children}</Animated.View>
        {label !== null && target !== null ? (
          <View
            pointerEvents="none"
            style={styles.badge}
            accessibilityLiveRegion="polite"
          >
            <Text variant="headline" figure tone="onTint">
              {label}
            </Text>
            <Text variant="caption2" figure tone="onTint" style={styles.shift}>
              {target === base ? "Drag up or down" : formatShift(target - base)}
            </Text>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  lifted: {
    backgroundColor: colors.fill,
  },
  badge: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.label,
    marginVertical: spacing.sm,
  },
  shift: {
    opacity: 0.75,
  },
});
