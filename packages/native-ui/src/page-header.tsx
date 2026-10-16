import { SymbolView, type SymbolViewProps } from "expo-symbols";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./text";
import { colors, spacing } from "./theme";

/** A tab root's large title with its actions on the same row. */
export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text variant="largeTitle" style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

export function HeaderButton({
  symbol,
  label,
  onPress,
}: {
  symbol: SymbolViewProps["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.5 }]}
    >
      <SymbolView name={symbol} size={20} tintColor={colors.label} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: { flex: 1 },
  actions: { flexDirection: "row", gap: spacing.lg },
  button: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
});
