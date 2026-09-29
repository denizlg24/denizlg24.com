import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { colors, sheetGutter, spacing, Text } from "@/ui";

export interface SheetHeaderProps {
  title: string;
  onCancel: () => void;
  confirm?: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    busy?: boolean;
  };
}

/** Cancel / title / confirm, the bar every iOS edit sheet carries. */
export function SheetHeader({ title, onCancel, confirm }: SheetHeaderProps) {
  const inactive = Boolean(confirm?.disabled || confirm?.busy);
  return (
    <View style={styles.bar}>
      <Pressable
        onPress={onCancel}
        hitSlop={10}
        accessibilityRole="button"
        style={styles.side}
      >
        <Text variant="body">Cancel</Text>
      </Pressable>
      <Text
        variant="headline"
        align="center"
        numberOfLines={1}
        style={styles.title}
      >
        {title}
      </Text>
      <View style={[styles.side, styles.trailing]}>
        {confirm ? (
          confirm.busy ? (
            <ActivityIndicator color={colors.label} />
          ) : (
            <Pressable
              onPress={confirm.onPress}
              disabled={inactive}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityState={{ disabled: inactive }}
            >
              <Text
                variant="body"
                weight="semibold"
                tone={inactive ? "tertiary" : "primary"}
              >
                {confirm.label}
              </Text>
            </Pressable>
          )
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: sheetGutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  side: {
    minWidth: 72,
  },
  trailing: {
    alignItems: "flex-end",
  },
  title: {
    flex: 1,
  },
});
