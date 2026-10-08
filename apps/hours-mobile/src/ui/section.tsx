import { SymbolView } from "expo-symbols";
import type { ReactNode } from "react";
import {
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { Text } from "./text";
import { colors, hairline, spacing } from "./theme";

/** The house style separates with lines, never boxes. */
export function Hairline({ style }: { style?: ViewStyle }) {
  return (
    <View
      style={[{ height: hairline, backgroundColor: colors.separator }, style]}
    />
  );
}

/** An uppercase label and a hairline, then content. No card, no border. */
export function Section({
  title,
  trailing,
  children,
  style,
}: {
  title?: string;
  trailing?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      {title ? (
        <View style={styles.header}>
          <Text variant="footnote" tone="secondary" eyebrow>
            {title}
          </Text>
          <View style={styles.rule} />
          {trailing}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export interface RowProps extends Omit<PressableProps, "children" | "style"> {
  title: string;
  subtitle?: string;
  value?: string;
  valueTone?: "primary" | "secondary" | "working";
  trailing?: ReactNode;
  chevron?: boolean;
  destructive?: boolean;
  separator?: boolean;
}

export function Row({
  title,
  subtitle,
  value,
  valueTone = "secondary",
  trailing,
  chevron = false,
  destructive = false,
  separator = true,
  onPress,
  ...rest
}: RowProps) {
  const content = (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text
          variant="body"
          tone={destructive ? "destructive" : "primary"}
          figure
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="body" tone={valueTone} figure weight="medium">
          {value}
        </Text>
      ) : null}
      {trailing}
      {chevron ? (
        <SymbolView
          name="chevron.right"
          size={12}
          weight="semibold"
          tintColor={colors.tertiaryLabel}
        />
      ) : null}
    </View>
  );
  return (
    <View>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={({ pressed }) => pressed && { opacity: 0.55 }}
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

/** A labelled figure in a row of stats. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption2" tone="secondary" eyebrow>
        {label}
      </Text>
      <Text variant="title3" figure weight="semibold">
        {value}
      </Text>
    </View>
  );
}

/** An error inside the surface that raised it — never a toast. */
export function Notice({ message }: { message: string }) {
  return (
    <View style={styles.notice}>
      <SymbolView
        name="exclamationmark.circle"
        size={15}
        tintColor={colors.destructive}
      />
      <Text variant="footnote" tone="destructive" style={{ flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  rule: { flex: 1, height: hairline, backgroundColor: colors.separator },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.sm,
  },
  rowText: { flex: 1, gap: 2 },
  stat: { flex: 1, gap: spacing.xxs },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
});
