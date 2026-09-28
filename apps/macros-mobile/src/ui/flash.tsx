import { type ReactNode, useEffect, useRef } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useResolvedColors } from "./theme";

export interface FlashProps {
  /**
   * Change this to replay the flash — typically the id of the entry that was
   * just logged or the timestamp of the last successful save.
   */
  token: string | number | null | undefined;
  tone?: "neutral" | "destructive";
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * The place where something happened tints briefly. This is the confirmation
 * a toast would otherwise give, without covering what was touched.
 */
export function Flash({
  token,
  tone = "neutral",
  children,
  style,
}: FlashProps) {
  const resolved = useResolvedColors();
  const tint = tone === "destructive" ? "rgba(255,59,48,0.22)" : resolved.fill;
  const progress = useSharedValue(0);
  const previous = useRef(token);

  useEffect(() => {
    if (token === previous.current) return;
    previous.current = token;
    if (token === null || token === undefined) return;
    progress.value = withSequence(
      withTiming(1, { duration: 90 }),
      withTiming(0, { duration: 900 }),
    );
  }, [token, progress]);

  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ["rgba(0,0,0,0)", tint],
    ),
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
