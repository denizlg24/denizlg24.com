import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, Icon, type IconName, spacing, Text } from "@/ui";

export interface SheetHeaderAction {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}

/**
 * The top of a detent sheet: sheets here hide the navigation bar, so the
 * title and the few actions a sheet has sit in its own first row.
 */
export function SheetHeader({
  title,
  subtitle,
  leading,
  actions = [],
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  actions?: SheetHeaderAction[];
}) {
  return (
    <View style={styles.row}>
      {leading}
      <View style={styles.text}>
        <Text variant="title3" numberOfLines={2} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="subheadline" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          onPress={action.onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={
            action.active === undefined
              ? undefined
              : { selected: action.active }
          }
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Icon
            name={action.icon}
            size={17}
            color={colors.label}
            filled={action.active === true}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  action: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tertiaryFill,
  },
  pressed: {
    opacity: 0.6,
  },
});
