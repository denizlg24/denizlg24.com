import type { ReactNode } from "react";
import {
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { colors, hairline, spacing } from "./theme";

/** A hairline rule. The house style separates with lines, never boxes. */
export function Hairline({
  inset = 0,
  style,
}: {
  inset?: number;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          height: hairline,
          backgroundColor: colors.separator,
          marginLeft: inset,
        },
        style,
      ]}
    />
  );
}

export interface SectionProps {
  title?: string;
  /** Trailing header control, e.g. "See all". */
  action?: { label: string; onPress: () => void };
  footer?: string;
  children: ReactNode;
  style?: ViewStyle;
}

/**
 * Editorial section: an uppercase label followed by a hairline, then content.
 * No card, no border — typography carries the hierarchy.
 */
export function Section({
  title,
  action,
  footer,
  children,
  style,
}: SectionProps) {
  return (
    <View style={style}>
      {title ? (
        <View style={styles.header}>
          <Text variant="footnote" tone="secondary" eyebrow>
            {title}
          </Text>
          <View style={styles.rule} />
          {action ? (
            <Pressable onPress={action.onPress} hitSlop={8}>
              <Text variant="footnote" weight="semibold">
                {action.label}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
      {footer ? (
        <Text variant="footnote" tone="secondary" style={styles.footer}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export interface RowProps extends Omit<PressableProps, "children" | "style"> {
  title: string;
  subtitle?: string;
  /** Trailing value, e.g. "420 kcal". Rendered as a figure. */
  value?: string;
  valueTone?: "primary" | "secondary";
  icon?: IconName;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  destructive?: boolean;
  /** Draw the separator under this row (off for the last row). */
  separator?: boolean;
  style?: ViewStyle;
}

export function Row({
  title,
  subtitle,
  value,
  valueTone = "secondary",
  icon,
  leading,
  trailing,
  chevron = false,
  destructive = false,
  separator = true,
  style,
  onPress,
  ...rest
}: RowProps) {
  const content = (
    <View style={styles.rowInner}>
      {leading ??
        (icon ? (
          <Icon
            name={icon}
            size={20}
            color={destructive ? colors.destructive : colors.secondaryLabel}
          />
        ) : null)}
      <View style={styles.rowText}>
        <Text
          variant="body"
          tone={destructive ? "destructive" : "primary"}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="subheadline" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="body" tone={valueTone} figure numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {chevron ? (
        <Icon
          name="chevron-right"
          size={13}
          weight="semibold"
          color={colors.tertiaryLabel}
        />
      ) : null}
    </View>
  );

  return (
    <View style={style}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          style={({ pressed }) => pressed && { backgroundColor: colors.fill }}
          {...rest}
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
      {separator ? <Hairline /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  rule: {
    flex: 1,
    height: hairline,
    backgroundColor: colors.separator,
  },
  footer: {
    marginTop: spacing.sm,
  },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
});
