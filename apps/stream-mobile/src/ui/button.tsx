import * as Haptics from "expo-haptics";
import type { LucideIcon } from "lucide-react-native";
import { useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "./text";
import { colors, radius, spacing, type TypeVariant } from "./theme";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

export interface ButtonProps
  extends Omit<PressableProps, "children" | "style"> {
  label: string;
  icon?: LucideIcon;
  variant?: Variant;
  loading?: boolean;
  /** Full width of the parent. */
  block?: boolean;
  /** `classic` is the big-type layout's button: taller, 20 pt label. */
  size?: "regular" | "large" | "classic";
  /** Solid glyphs, e.g. the play triangle. */
  filledIcon?: boolean;
}

/** A repeat press within this window is dropped, so a write never runs twice. */
const REPEAT_MS = 600;

const labelVariant: Record<NonNullable<ButtonProps["size"]>, TypeVariant> = {
  regular: "callout",
  large: "headline",
  classic: "classicLabel",
};

export function Button({
  label,
  icon: Icon,
  variant = "primary",
  loading,
  block,
  size = "regular",
  disabled,
  onPress,
  filledIcon,
  ...props
}: ButtonProps) {
  const last = useRef(0);
  const background =
    variant === "primary"
      ? colors.amber
      : variant === "secondary"
        ? colors.fill
        : "transparent";
  const foreground =
    variant === "primary"
      ? colors.onAmber
      : variant === "destructive"
        ? colors.danger
        : colors.paper;
  const inactive = disabled || loading;

  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={(event) => {
        const now = Date.now();
        if (now - last.current < REPEAT_MS) return;
        last.current = now;
        void Haptics.selectionAsync().catch(() => undefined);
        onPress?.(event);
      }}
      style={({ pressed }) => [
        styles.base,
        size === "large" ? styles.large : null,
        size === "classic" ? styles.classic : null,
        variant === "primary" ? styles.pill : null,
        block ? styles.block : null,
        {
          backgroundColor: background,
          opacity: inactive ? 0.4 : pressed ? 0.72 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.row}>
          {Icon ? (
            <Icon
              color={foreground}
              size={size === "classic" ? 24 : size === "large" ? 20 : 17}
              fill={filledIcon ? foreground : "none"}
            />
          ) : null}
          <Text
            variant={labelVariant[size]}
            style={{ color: foreground }}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  large: { minHeight: 52, paddingHorizontal: spacing.xl },
  classic: { minHeight: 64, paddingHorizontal: spacing.xxl },
  block: { alignSelf: "stretch" },
  pill: { borderRadius: radius.pill },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
