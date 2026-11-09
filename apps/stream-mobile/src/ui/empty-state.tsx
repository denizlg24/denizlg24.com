import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "./text";
import { colors, spacing } from "./theme";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  message: string;
  /** Usually one `Button` saying what to do next. */
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <Icon color={colors.muted} size={36} strokeWidth={1.3} />
      <Text variant="title" style={styles.center}>
        {title}
      </Text>
      <Text
        variant="body"
        color="muted"
        style={[styles.center, styles.message]}
      >
        {message}
      </Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
    gap: spacing.md,
  },
  center: { textAlign: "center" },
  message: { maxWidth: 360 },
  action: { marginTop: spacing.md },
});
