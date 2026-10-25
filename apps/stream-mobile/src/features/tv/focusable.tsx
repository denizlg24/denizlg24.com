import { type ReactNode, useState } from "react";
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { colors } from "@/ui";

export interface FocusableProps
  extends Omit<PressableProps, "children" | "style" | "onFocus" | "onBlur"> {
  children: ReactNode | ((focused: boolean) => ReactNode);
  style?: StyleProp<ViewStyle>;
  /** Takes focus when it mounts: the first thing a screen offers. */
  preferred?: boolean;
  /** How much the surface grows under focus. */
  grow?: number;
  /** Corner radius of the focus ring; match the content's own. */
  radius?: number;
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * Anything the remote can land on. Android moves focus between these with
 * the D-pad and turns OK into `onPress`; this only draws where focus is: an
 * amber ring and a small lift.
 */
export function Focusable({
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
  const [focused, setFocused] = useState(false);
  const lift = useAnimatedStyle(() => ({
    transform: [{ scale: withTiming(focused ? grow : 1, { duration: 140 }) }],
  }));

  return (
    <Pressable
      {...props}
      disabled={disabled}
      focusable={!disabled}
      // Typed as Apple TV only and deprecated, but Android's view manager
      // still implements it: it requests focus when the prop turns true.
      hasTVPreferredFocus={preferred}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur?.();
      }}
    >
      <Animated.View style={[style, lift]}>
        {typeof children === "function" ? children(focused) : children}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            { borderRadius: radius + 3 },
            focused ? styles.ringOn : null,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: "absolute",
    top: -3,
    right: -3,
    bottom: -3,
    left: -3,
    borderWidth: 3,
    borderColor: "transparent",
  },
  ringOn: { borderColor: colors.amber },
});
