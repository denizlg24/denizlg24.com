import { memo, type ReactNode, useState } from "react";
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { colors } from "@/ui";

/** Room a scrolling row leaves around its items so a focused one isn't clipped. */
export const FOCUS_ROOM = 12;
const RING = 3;
const GAP = 2;
const EASE = { duration: 120 } as const;

export interface FocusableProps
  extends Omit<PressableProps, "children" | "style" | "onFocus" | "onBlur"> {
  /** A function child re-renders on focus; plain children never do. */
  children: ReactNode | ((focused: boolean) => ReactNode);
  style?: StyleProp<ViewStyle>;
  /** Takes focus when it mounts: the first thing a screen offers. */
  preferred?: boolean;
  /** How much the surface grows under focus. */
  grow?: number;
  /** Corner radius of the content; the ring follows it. */
  radius?: number;
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * Anything the remote can land on. Android moves focus between these with
 * the D-pad and turns OK into `onPress`; this only draws where focus is: an
 * amber ring just outside the content, and a small lift. Both run on the UI
 * thread, so moving focus re-renders nothing in React. The system's own
 * grey focus highlight is switched off in the theme (`with-android-tv`).
 */
export const Focusable = memo(function Focusable({
  children,
  style,
  preferred = false,
  grow = 1.06,
  radius = 8,
  onFocus,
  onBlur,
  disabled,
  ...props
}: FocusableProps) {
  const rendersFocus = typeof children === "function";
  const [focused, setFocused] = useState(false);
  const focus = useSharedValue(0);
  const lift = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (grow - 1) * focus.value }],
  }));
  const ring = useAnimatedStyle(() => ({ opacity: focus.value }));

  return (
    <Pressable
      {...props}
      disabled={disabled}
      focusable={!disabled}
      // Typed as Apple TV only and deprecated, but Android's view manager
      // still implements it: it requests focus when the prop turns true.
      hasTVPreferredFocus={preferred}
      onFocus={() => {
        focus.value = withTiming(1, EASE);
        if (rendersFocus) setFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        focus.value = withTiming(0, EASE);
        if (rendersFocus) setFocused(false);
        onBlur?.();
      }}
    >
      <Animated.View style={[style, lift]}>
        {typeof children === "function" ? children(focused) : children}
        <Animated.View
          pointerEvents="none"
          style={[styles.ring, { borderRadius: radius + GAP + RING }, ring]}
        />
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  ring: {
    position: "absolute",
    top: -(GAP + RING),
    right: -(GAP + RING),
    bottom: -(GAP + RING),
    left: -(GAP + RING),
    borderWidth: RING,
    borderColor: colors.amber,
  },
});
