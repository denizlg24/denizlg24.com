import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { colors, radius, spacing } from "./theme";

export interface SheetHeaderAction {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}

/**
 * The first row of every sheet that runs without a navigation bar: title,
 * optional artwork, the sheet's few actions and Close, all one size and on
 * one centre line. It carries no outer padding; the sheet's container sets
 * the gutter and the space under the grabber, so every sheet starts at the
 * same place.
 */
export function SheetHeader({
  title,
  subtitle,
  leading,
  actions = [],
  onClose,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  actions?: SheetHeaderAction[];
  onClose?: () => void;
}) {
  return (
    <View style={styles.row}>
      {leading}
      <View style={styles.titles}>
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
        <HeaderButton
          key={action.label}
          label={action.label}
          onPress={action.onPress}
          selected={action.active}
        >
          <Icon
            name={action.icon}
            size={16}
            weight="medium"
            color={colors.label}
            filled={action.active === true}
          />
        </HeaderButton>
      ))}
      {onClose ? (
        <HeaderButton label="Close" onPress={onClose}>
          <Icon
            name="x"
            size={15}
            weight="semibold"
            color={colors.secondaryLabel}
          />
        </HeaderButton>
      ) : null}
    </View>
  );
}

function HeaderButton({
  label,
  onPress,
  selected,
  children,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
  },
  titles: {
    flex: 1,
    gap: spacing.xxs,
  },
  button: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tertiaryFill,
  },
  pressed: {
    opacity: 0.6,
  },
});
