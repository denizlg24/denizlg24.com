import { SymbolView, type SymbolViewProps } from "expo-symbols";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useSinglePress } from "@/lib/use-single-press";
import { Text } from "./text";
import { colors, radius, spacing } from "./theme";

export type ButtonVariant = "filled" | "tinted" | "plain" | "destructive";

export interface ButtonProps
  extends Omit<PressableProps, "children" | "style"> {
  label: string;
  variant?: ButtonVariant;
  size?: "large" | "regular" | "small";
  symbol?: SymbolViewProps["name"];
  loading?: boolean;
  block?: boolean;
  style?: ViewStyle;
}

const heights = { large: 50, regular: 44, small: 32 } as const;

export function Button({
  label,
  variant = "filled",
  size = "large",
  symbol,
  loading = false,
  block = size === "large",
  disabled,
  style,
  onPress,
  ...rest
}: ButtonProps) {
  const inactive = disabled || loading;
  const press = useSinglePress(onPress);
  const foreground =
    variant === "filled"
      ? colors.onTint
      : variant === "destructive"
        ? colors.destructive
        : colors.label;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: loading }}
      disabled={inactive}
      {...rest}
      onPress={press}
      style={({ pressed }) => [
        styles.base,
        { minHeight: heights[size] },
        size === "small" && styles.small,
        block && styles.block,
        variant === "filled" && { backgroundColor: colors.tint },
        (variant === "tinted" || variant === "destructive") && {
          backgroundColor: colors.tertiaryFill,
        },
        variant === "plain" && styles.plain,
        pressed && styles.pressed,
        inactive && styles.inactive,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={foreground} />
        ) : (
          <>
            {symbol ? (
              <SymbolView
                name={symbol}
                size={size === "small" ? 14 : 16}
                tintColor={foreground}
                weight="semibold"
              />
            ) : null}
            <Text
              variant={size === "small" ? "subheadline" : "body"}
              weight="semibold"
              style={{ color: foreground }}
            >
              {label}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  small: { borderRadius: radius.pill, paddingHorizontal: spacing.md },
  block: { alignSelf: "stretch" },
  plain: { paddingHorizontal: 0 },
  content: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pressed: { opacity: 0.7 },
  inactive: { opacity: 0.4 },
});
