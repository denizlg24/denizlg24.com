import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { colors, waterColor } from "@/ui";

const WIDTH = 120;
const HEIGHT = 180;
const RIM = 2;
const INNER_WIDTH = WIDTH - RIM * 2;
const INNER_HEIGHT = HEIGHT - RIM;
const WAVE_HEIGHT = 10;
const TICKS = [0.25, 0.5, 0.75] as const;

// Two periods side by side, so sliding it one period left loops seamlessly.
const WAVE = (() => {
  const period = INNER_WIDTH;
  const mid = WAVE_HEIGHT / 2;
  const amplitude = WAVE_HEIGHT / 2 - 1;
  let d = `M 0 ${mid}`;
  for (let x = 0; x <= period * 2; x += 4) {
    const y = mid + Math.sin((x / period) * Math.PI * 2) * amplitude;
    d += ` L ${x} ${y.toFixed(2)}`;
  }
  return `${d} L ${period * 2} ${WAVE_HEIGHT} L 0 ${WAVE_HEIGHT} Z`;
})();

/**
 * A tumbler that holds `fraction` of its capacity, the surface rolling.
 * Touching or dragging on it reports the fraction under the finger.
 */
export function Glass({
  fraction,
  onPick,
  onStep,
  accessibilityLabel,
}: {
  fraction: number;
  onPick: (fraction: number) => void;
  /** VoiceOver's swipe up and down on the glass. */
  onStep: (direction: 1 | -1) => void;
  accessibilityLabel: string;
}) {
  const level = useSharedValue(0);
  const phase = useSharedValue(0);

  useEffect(() => {
    level.value = withSpring(fraction, { damping: 16, stiffness: 140 });
  }, [fraction, level]);

  useEffect(() => {
    phase.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.linear }),
      -1,
    );
  }, [phase]);

  const water = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          (1 - level.value) * (INNER_HEIGHT + WAVE_HEIGHT) - WAVE_HEIGHT,
      },
    ],
  }));
  const wave = useAnimatedStyle(() => ({
    transform: [{ translateX: -phase.value * INNER_WIDTH }],
  }));

  const pick = useRef(onPick);
  pick.current = onPick;
  const gesture = useMemo(() => {
    const at = (y: number) => pick.current(1 - y / INNER_HEIGHT);
    return Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin((event) => at(event.y))
      .onUpdate((event) => at(event.y));
  }, []);

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.glass}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) =>
          onStep(event.nativeEvent.actionName === "increment" ? 1 : -1)
        }
      >
        <Animated.View style={[styles.water, water]}>
          <Animated.View style={[styles.wave, wave]}>
            <Svg width={INNER_WIDTH * 2} height={WAVE_HEIGHT}>
              <Path d={WAVE} fill={waterColor} fillOpacity={0.85} />
            </Svg>
          </Animated.View>
          <View style={styles.body} />
        </Animated.View>
        {TICKS.map((tick) => (
          <View
            key={tick}
            style={[styles.tick, { bottom: tick * INNER_HEIGHT }]}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  glass: {
    width: WIDTH,
    height: HEIGHT,
    borderWidth: RIM,
    borderTopWidth: 0,
    borderColor: colors.tertiaryLabel,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    overflow: "hidden",
  },
  water: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: INNER_HEIGHT + WAVE_HEIGHT,
  },
  wave: {
    width: INNER_WIDTH * 2,
    height: WAVE_HEIGHT,
  },
  body: {
    flex: 1,
    backgroundColor: waterColor,
    opacity: 0.85,
  },
  tick: {
    position: "absolute",
    left: 0,
    width: 12,
    height: RIM,
    backgroundColor: colors.tertiaryLabel,
  },
});
