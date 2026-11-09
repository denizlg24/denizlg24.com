import {
  memo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  findNodeHandle,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  type View,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { colors } from "@/ui";
import { useFocusMemory, useIsRestoreTarget } from "./focus-memory";

/** Room a scrolling row leaves around its items so a focused one isn't clipped. */
export const FOCUS_ROOM = 12;
const RING = 3;
const GAP = 2;
const EASE = { duration: 120 } as const;

export type FocusDirection = "up" | "down" | "left" | "right";

/** Android's `nextFocus*` props: a native view id, or this view itself. */
export type FocusTargets = Partial<Record<FocusDirection, number | "self">>;

export interface FocusableProps
  extends Omit<PressableProps, "children" | "style" | "onFocus" | "onBlur"> {
  /** A function child re-renders on focus; plain children never do. */
  children: ReactNode | ((focused: boolean) => ReactNode);
  style?: StyleProp<ViewStyle>;
  /** Takes focus when it turns true: a screen's first focus. */
  preferred?: boolean;
  /** How much the surface grows under focus. */
  grow?: number;
  /** Corner radius of the content; the ring follows it. */
  radius?: number;
  /** No ring: the child draws focus itself (keys, menu items). */
  ringless?: boolean;
  /** Noted in the screen's `FocusMemory`, so focus can come back here. */
  focusKey?: string;
  /** Where the remote goes from here, overriding Android's geometric search. */
  next?: FocusTargets;
  /** This view's native id, for neighbours that name it in their `next`. */
  onNativeTag?: (tag: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

const NEXT_PROP = {
  up: "nextFocusUp",
  down: "nextFocusDown",
  left: "nextFocusLeft",
  right: "nextFocusRight",
} as const;
const DIRECTIONS: FocusDirection[] = ["up", "down", "left", "right"];

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
  ringless = false,
  focusKey,
  next,
  onNativeTag,
  onFocus,
  onBlur,
  disabled,
  focusable,
  ...props
}: FocusableProps) {
  const rendersFocus = typeof children === "function";
  const [focused, setFocused] = useState(false);
  const memory = useFocusMemory();
  const restoring = useIsRestoreTarget(memory, focusKey);
  const self = useNativeTag(
    onNativeTag !== undefined ||
      (next !== undefined && Object.values(next).includes("self")),
  );
  useEffect(() => {
    if (self.tag !== null) onNativeTag?.(self.tag);
  }, [self.tag, onNativeTag]);
  // `hasTVPreferredFocus` acts only when it turns true. A `preferred` view
  // is already true, so for a restore it drops for one frame and rises again.
  const [bounce, setBounce] = useState(false);
  useEffect(() => {
    if (!restoring || !preferred) return;
    setBounce(true);
    const frame = requestAnimationFrame(() => setBounce(false));
    return () => cancelAnimationFrame(frame);
  }, [restoring, preferred]);
  const focus = useSharedValue(0);
  const lift = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (grow - 1) * focus.value }],
  }));
  const ring = useAnimatedStyle(() => ({ opacity: focus.value }));

  // `nextFocus*` are Android view props React Native's types leave out; a
  // spread carries them to the view without widening anything.
  const nextProps: Partial<Record<(typeof NEXT_PROP)[FocusDirection], number>> =
    {};
  for (const direction of DIRECTIONS) {
    const target = next?.[direction];
    const id = target === "self" ? self.tag : target;
    if (typeof id === "number") nextProps[NEXT_PROP[direction]] = id;
  }

  return (
    <Pressable
      {...props}
      {...nextProps}
      ref={self.ref}
      disabled={disabled}
      focusable={focusable ?? !disabled}
      // Android turns an `accessible` view focusable again whatever
      // `focusable` says, so a view held out of focus must not be one.
      accessible={focusable === false ? false : props.accessible}
      // Typed as Apple TV only and deprecated, but Android's view manager
      // still implements it: it requests focus when the prop turns true.
      hasTVPreferredFocus={(preferred || restoring) && !bounce}
      onFocus={() => {
        focus.value = withTiming(1, EASE);
        if (rendersFocus) setFocused(true);
        if (focusKey) memory?.note(focusKey);
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
        {ringless ? null : (
          <Animated.View
            pointerEvents="none"
            style={[styles.ring, { borderRadius: radius + GAP + RING }, ring]}
          />
        )}
      </Animated.View>
    </Pressable>
  );
});

/**
 * The native view id behind a ref, for `nextFocus*`. React Native sets every
 * Android view's id to its tag. Read once after mount, only when asked for.
 */
export function useNativeTag(enabled = true) {
  const ref = useRef<View>(null);
  const [tag, setTag] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    setTag(findNodeHandle(ref.current));
  }, [enabled]);
  return { ref, tag };
}

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
