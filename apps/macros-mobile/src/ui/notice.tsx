import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { Icon } from "./icon";
import { Text } from "./text";
import { colors, spacing } from "./theme";

export interface InlineNoticeProps {
  message: string;
  tone?: "error" | "info" | "offline";
  action?: { label: string; onPress: () => void };
  onDismiss?: () => void;
  style?: ViewStyle;
}

/**
 * Macros has no toasts: a toast covers the row that was just touched.
 * Feedback is a terse line inside the surface that raised it.
 */
export function InlineNotice({
  message,
  tone = "error",
  action,
  onDismiss,
  style,
}: InlineNoticeProps) {
  const color =
    tone === "error"
      ? colors.destructive
      : tone === "offline"
        ? colors.warning
        : colors.secondaryLabel;
  const icon =
    tone === "error"
      ? "circle-alert"
      : tone === "offline"
        ? "wifi-off"
        : "info";

  return (
    <View style={[styles.row, style]} accessibilityRole="alert">
      <Icon name={icon} size={15} color={color} />
      <Text variant="footnote" style={[styles.message, { color }]}>
        {message}
      </Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text variant="footnote" weight="semibold">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
      {onDismiss ? (
        <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss">
          <Icon name="x" size={12} color={colors.tertiaryLabel} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  message: {
    flex: 1,
  },
});
