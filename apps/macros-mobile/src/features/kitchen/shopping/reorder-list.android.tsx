import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { colors, gutter, Hairline, Icon, spacing, Text } from "@/ui";
import type * as Shared from "./reorder-list";

/** SwiftUI's edit-mode list has no Compose twin: rows move one step a tap. */
export const ReorderList: typeof Shared.ReorderList = ({ items, onMove }) => (
  <ScrollView
    style={{ backgroundColor: colors.background }}
    contentContainerStyle={styles.content}
  >
    {items.map((item, index) => (
      <View key={item.id}>
        <View style={styles.row}>
          <Text variant="body" numberOfLines={2} style={styles.label}>
            {item.label}
          </Text>
          <MoveButton
            icon="chevron-up"
            label={`Move ${item.label} up`}
            disabled={index === 0}
            onPress={() => onMove([index], index - 1)}
          />
          <MoveButton
            icon="chevron-down"
            label={`Move ${item.label} down`}
            disabled={index === items.length - 1}
            onPress={() => onMove([index], index + 2)}
          />
        </View>
        <Hairline inset={gutter} />
      </View>
    ))}
  </ScrollView>
);

function MoveButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "chevron-up" | "chevron-down";
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.move,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon name={icon} size={20} color={colors.secondaryLabel} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing.xxxl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingLeft: gutter,
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
  },
  label: {
    flex: 1,
  },
  move: {
    padding: spacing.sm,
    borderRadius: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.fill,
  },
  disabled: {
    opacity: 0.3,
  },
});
