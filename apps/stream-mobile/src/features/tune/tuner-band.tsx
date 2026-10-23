import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { colors, spacing, Text } from "@/ui";
import { stopAt, stopFraction } from "./dials";

const BAND_HEIGHT = 44;
const SPRING = { damping: 22, stiffness: 260 };

function tick() {
  void Haptics.selectionAsync().catch(() => undefined);
}

interface BandBase {
  title: string;
  /** What the dial is set to, in words: "1h30", "The 1980s". */
  reading: string;
  count: number;
  /** Labels under the ticks; null leaves a tick unlabelled. */
  labels: (string | null)[];
  /** Tapping the reading clears the dial back to "any". */
  onReset?: () => void;
  /** Shaded window either side of the needle, in stops (the mood dial). */
  windowStops?: number;
}

/**
 * One tuner band: a track of ticks with a glowing needle. Dragging or
 * tapping moves the needle stop by stop with a haptic tick on each; the
 * value is committed when the finger lifts. A null `value` hides the needle
 * (the dial is open).
 */
export function TunerBand({
  value,
  onChange,
  ...band
}: BandBase & { value: number | null; onChange: (index: number) => void }) {
  return (
    <Band
      {...band}
      needles={value === null ? [] : [value]}
      onNeedles={(next) => {
        const first = next[0];
        if (first !== undefined) onChange(first);
      }}
    />
  );
}

/** Two needles on one band (the era dial); the nearer one follows the finger. */
export function RangeBand({
  value,
  onChange,
  ...band
}: BandBase & {
  value: [number, number];
  onChange: (value: [number, number]) => void;
}) {
  return (
    <Band
      {...band}
      needles={value}
      onNeedles={(next) => {
        const [a, b] = next;
        if (a !== undefined && b !== undefined) onChange([a, b]);
      }}
    />
  );
}

function Band({
  title,
  reading,
  count,
  labels,
  onReset,
  windowStops,
  needles,
  onNeedles,
}: BandBase & {
  needles: number[];
  onNeedles: (needles: number[]) => void;
}) {
  const width = useSharedValue(0);
  const range = needles.length === 2;
  const a = useSharedValue(needles[0] ?? -1);
  const b = useSharedValue(needles[1] ?? -1);
  const active = useSharedValue(0);

  useEffect(() => {
    a.value = needles[0] ?? -1;
    b.value = needles[1] ?? -1;
  }, [needles, a, b]);

  const commit = (first: number, second: number) =>
    onNeedles(range ? [first, second] : [first]);

  const move = (x: number, begin: boolean) => {
    "worklet";
    const index = stopAt(x, width.value, count);
    if (begin) {
      active.value =
        range && Math.abs(index - b.value) < Math.abs(index - a.value) ? 1 : 0;
    }
    if (active.value === 1) {
      if (index !== b.value) {
        b.value = index;
        scheduleOnRN(tick);
      }
    } else if (index !== a.value) {
      a.value = index;
      scheduleOnRN(tick);
    }
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onBegin((event) => move(event.x, true))
    .onUpdate((event) => move(event.x, false))
    .onEnd(() => scheduleOnRN(commit, a.value, b.value));
  const tap = Gesture.Tap().onEnd((event) => {
    move(event.x, true);
    scheduleOnRN(commit, a.value, b.value);
  });
  const gesture = Gesture.Race(pan, tap);

  const windowStyle = useAnimatedStyle(() => {
    const stops = windowStops ?? 0;
    const step = count > 1 ? width.value / (count - 1) : 0;
    return {
      opacity: a.value < 0 || stops === 0 ? 0 : 1,
      width: stops * 2 * step,
      transform: [
        {
          translateX: withSpring(
            stopFraction(Math.max(0, a.value), count) * width.value -
              stops * step,
            SPRING,
          ),
        },
      ],
    };
  });
  const spanStyle = useAnimatedStyle(() => {
    const lo = Math.min(a.value, b.value);
    const hi = Math.max(a.value, b.value);
    return {
      opacity: range ? 1 : 0,
      left: withSpring(
        stopFraction(Math.max(0, lo), count) * width.value,
        SPRING,
      ),
      width: withSpring(
        (stopFraction(Math.max(0, hi), count) -
          stopFraction(Math.max(0, lo), count)) *
          width.value,
        SPRING,
      ),
    };
  });

  return (
    <View style={styles.band}>
      <View style={styles.head}>
        <Text variant="label" color="muted">
          {title}
        </Text>
        <Pressable
          disabled={!onReset}
          onPress={onReset}
          accessibilityRole={onReset ? "button" : undefined}
          accessibilityLabel={
            onReset ? `${title}: ${reading}. Tap to clear` : undefined
          }
          hitSlop={8}
        >
          <Text variant="heading" color="paper">
            {reading}
          </Text>
        </Pressable>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={title}
          accessibilityValue={{ text: reading }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            const step = event.nativeEvent.actionName === "increment" ? 1 : -1;
            const current = needles[range ? 1 : 0] ?? 0;
            const next = Math.min(count - 1, Math.max(0, current + step));
            onNeedles(range ? [needles[0] ?? 0, next] : [next]);
          }}
          onLayout={(event: LayoutChangeEvent) => {
            width.value = event.nativeEvent.layout.width;
          }}
          style={styles.track}
        >
          <View style={styles.rail} />
          <Animated.View style={[styles.window, windowStyle]} />
          <Animated.View style={[styles.span, spanStyle]} />
          {Array.from({ length: count }, (_, index) => (
            <View
              key={index}
              style={[
                styles.tick,
                {
                  left: `${stopFraction(index, count) * 100}%`,
                  height: labels[index] ? 14 : 8,
                },
              ]}
            />
          ))}
          <Needle index={a} count={count} width={width} />
          {range ? <Needle index={b} count={count} width={width} /> : null}
        </View>
      </GestureDetector>
      <View style={styles.labels}>
        {labels.map((label, index) =>
          label ? (
            <Text
              key={index}
              variant="caption"
              color="faint"
              style={[
                styles.label,
                { left: `${stopFraction(index, count) * 100}%` },
              ]}
            >
              {label}
            </Text>
          ) : null,
        )}
      </View>
    </View>
  );
}

function Needle({
  index,
  count,
  width,
}: {
  index: SharedValue<number>;
  count: number;
  width: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: index.value < 0 ? 0 : 1,
    transform: [
      {
        translateX: withSpring(
          stopFraction(Math.max(0, index.value), count) * width.value,
          SPRING,
        ),
      },
    ],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.needle, style]}>
      <View style={styles.glow} />
      <View style={styles.line} />
    </Animated.View>
  );
}

const NEEDLE = 3;

const styles = StyleSheet.create({
  band: { gap: spacing.xs },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  track: { height: BAND_HEIGHT, justifyContent: "center" },
  rail: {
    position: "absolute",
    left: 0,
    right: 0,
    top: BAND_HEIGHT / 2,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
  },
  tick: {
    position: "absolute",
    width: 1,
    marginLeft: -0.5,
    top: BAND_HEIGHT / 2 - 7,
    backgroundColor: colors.faint,
  },
  window: {
    position: "absolute",
    left: 0,
    top: 8,
    bottom: 8,
    borderRadius: 4,
    backgroundColor: "rgba(242,181,74,0.12)",
  },
  span: {
    position: "absolute",
    top: BAND_HEIGHT / 2 - 1,
    height: 2,
    backgroundColor: colors.amber,
    opacity: 0.6,
  },
  needle: {
    position: "absolute",
    left: -12,
    top: 0,
    bottom: 0,
    width: 24,
    alignItems: "center",
  },
  glow: {
    position: "absolute",
    top: 2,
    bottom: 2,
    width: 12,
    borderRadius: 6,
    backgroundColor: colors.amberGlow,
    opacity: 0.55,
  },
  line: {
    flex: 1,
    width: NEEDLE,
    borderRadius: NEEDLE / 2,
    backgroundColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  labels: { height: 16 },
  label: {
    position: "absolute",
    width: 48,
    marginLeft: -24,
    textAlign: "center",
  },
});
