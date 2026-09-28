import { Pressable, StyleSheet, View } from "react-native";
import { colors, Icon, radius, spacing, Text } from "@/ui";

/**
 * Form sheets here run without a navigation bar, so the title and the close
 * control sit in the content, where iOS puts them in its own compact sheets.
 */
export function SheetHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        <Text variant="title3" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="subheadline" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <Icon name="x" size={13} weight="bold" color={colors.secondaryLabel} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  titles: {
    flex: 1,
    gap: spacing.xxs,
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.tertiaryFill,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
});
