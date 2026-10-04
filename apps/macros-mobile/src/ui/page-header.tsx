import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSinglePress } from "@/lib/use-single-press";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { colors, radius, spacing } from "./theme";

/**
 * A tab's root title, drawn in the content with its actions on the same row.
 * A native large title keeps an empty navigation bar above it, which on a
 * root screen with nothing to go back to is a band of dead space.
 */
export function PageHeader({
  title,
  subtitle,
  onTitlePress,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Makes the title a button with a disclosure chevron (Log: the calendar). */
  onTitlePress?: () => void;
  /** Trailing actions: `HeaderIconButton`, `HeaderTextButton` or a menu. */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.container,
        // iOS insets the scroll content itself; Android draws under the bar.
        Platform.OS === "android" && { paddingTop: insets.top + spacing.sm },
      ]}
    >
      <View style={styles.row}>
        {onTitlePress ? (
          <Pressable
            onPress={onTitlePress}
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityHint="Opens the calendar"
            style={({ pressed }) => [
              styles.title,
              styles.titleButton,
              pressed && styles.pressed,
            ]}
          >
            <Text
              variant="largeTitle"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              accessibilityRole="header"
              style={styles.titleText}
            >
              {title}
            </Text>
            <Icon
              name="chevron-down"
              size={18}
              weight="semibold"
              color={colors.secondaryLabel}
            />
          </Pressable>
        ) : (
          <Text
            variant="largeTitle"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            accessibilityRole="header"
            style={styles.title}
          >
            {title}
          </Text>
        )}
        {children ? <View style={styles.actions}>{children}</View> : null}
      </View>
      {subtitle ? (
        <Text variant="subheadline" tone="secondary" numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/** Without `onPress` it is a menu's trigger: the menu owns the touch. */
export function HeaderIconButton({
  icon,
  label,
  onPress,
  disabled = false,
  destructive = false,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const press = useSinglePress(onPress);
  const tint = disabled
    ? colors.tertiaryLabel
    : destructive
      ? colors.destructive
      : colors.label;
  if (!onPress) {
    return (
      <View
        style={styles.icon}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Icon name={icon} size={18} weight="medium" color={tint} />
      </View>
    );
  }
  return (
    <Pressable
      onPress={press}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      <Icon name={icon} size={18} weight="medium" color={tint} />
    </Pressable>
  );
}

export function HeaderTextButton({
  label,
  onPress,
  prominent = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  prominent?: boolean;
  disabled?: boolean;
}) {
  const press = useSinglePress(onPress);
  return (
    <Pressable
      onPress={press}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.text,
        prominent && styles.textProminent,
        pressed && styles.pressed,
      ]}
    >
      <Text
        variant="subheadline"
        weight="semibold"
        tone={disabled ? "tertiary" : prominent ? "onTint" : "primary"}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const BUTTON = 36;

const styles = StyleSheet.create({
  container: {
    gap: spacing.xxs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: BUTTON,
  },
  title: {
    flex: 1,
  },
  titleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  titleText: {
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  icon: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tertiaryFill,
  },
  text: {
    height: BUTTON,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tertiaryFill,
  },
  textProminent: {
    backgroundColor: colors.tint,
  },
  pressed: {
    opacity: 0.6,
  },
});
