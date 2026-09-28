import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { colors, spacing } from "./theme";

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  message?: string;
  children?: ReactNode;
}

/** Macros is multi-user: empty states may explain what goes here. */
export function EmptyState({
  icon,
  title,
  message,
  children,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon ? (
        <Icon name={icon} size={34} color={colors.tertiaryLabel} />
      ) : null}
      <Text variant="headline" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="subheadline" tone="secondary" align="center">
          {message}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
});
