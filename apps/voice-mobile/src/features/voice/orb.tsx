import { useEffect } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  useColorScheme,
} from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedProps,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";
import type { VoiceState } from "./voice-controller";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 300;
const CENTER = SIZE / 2;
const POINTS = 72;

const PALETTE = {
  light: {
    core: "#f1f3e0",
    accent: "#a1bc98",
    deep: "#303630",
    error: "#c0352b",
  },
  dark: {
    core: "#e7ecd8",
    accent: "#8fa886",
    deep: "#1b1f1b",
    error: "#e0574c",
  },
};

/**
 * The PWA's orb in SVG: a breathing blob made of three slow harmonics, swelling
 * with the microphone level while listening and pulsing as a reply streams.
 */
export function VoiceOrb({
  state,
  level,
  pulse,
  onPress,
  onLongPress,
}: {
  state: VoiceState;
  level: SharedValue<number>;
  pulse: SharedValue<number>;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const colors = PALETTE[scheme];
  const time = useSharedValue(0);
  const energy = useSharedValue(0);
  const lastPulse = useSharedValue(0);
  const listening = useSharedValue(0);
  const thinking = useSharedValue(0);
  const reduced = useSharedValue(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      reduced.value = value;
    });
  }, [reduced]);

  useEffect(() => {
    listening.value = state === "listening" ? 1 : 0;
    thinking.value = state === "thinking" ? 1 : 0;
  }, [state, listening, thinking]);

  useFrameCallback((frame) => {
    time.value = frame.timestamp / 1000;
    if (lastPulse.value !== pulse.value) {
      lastPulse.value = pulse.value;
      energy.value = 1;
    }
    energy.value *= 0.9;
  });

  const blob = useAnimatedProps(() => {
    const seconds = time.value;
    const still = reduced.value;
    const base = SIZE * 0.3;
    const breathing = still ? 0 : Math.sin(seconds * 1.25) * 0.025;
    const radius =
      base *
      (1 +
        breathing +
        listening.value * level.value * 0.18 +
        energy.value * 0.06);
    let d = "";
    for (let index = 0; index <= POINTS; index++) {
      const angle = (index / POINTS) * Math.PI * 2;
      const harmonic = still
        ? 0
        : Math.sin(angle * 3 + seconds * 0.8) * 0.025 +
          Math.sin(angle * 5 - seconds * 0.55) * 0.014 +
          Math.sin(angle * 7 + seconds * 0.35) * 0.008;
      const r = radius * (1 + harmonic);
      const x = CENTER + Math.cos(angle) * r;
      const y = CENTER + Math.sin(angle) * r;
      d += `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
    }
    return { d: `${d}Z` };
  });

  const ring = useAnimatedProps(() => {
    const circumference = 2 * Math.PI * (SIZE * 0.39);
    return {
      strokeOpacity: thinking.value,
      strokeDasharray: [circumference * 0.35, circumference],
      strokeDashoffset: -((time.value * 1.7 * SIZE * 0.39) % circumference),
    };
  });

  const error = state === "error";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        state === "listening" ? "Stop listening" : "Start listening"
      }
      accessibilityHint="Long press for the conversation"
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.press}
    >
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Defs>
          <RadialGradient id="orb" cx="38%" cy="34%" r="70%">
            <Stop offset="0" stopColor={colors.core} />
            <Stop
              offset="0.48"
              stopColor={error ? colors.error : colors.accent}
            />
            <Stop offset="1" stopColor={colors.deep} />
          </RadialGradient>
        </Defs>
        <AnimatedCircle
          cx={CENTER}
          cy={CENTER}
          r={SIZE * 0.39}
          fill="none"
          stroke={colors.accent}
          strokeWidth={2}
          strokeLinecap="round"
          animatedProps={ring}
        />
        <AnimatedPath fill="url(#orb)" animatedProps={blob} />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { width: SIZE, height: SIZE },
});
