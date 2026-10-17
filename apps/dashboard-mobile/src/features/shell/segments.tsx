import { colors, haptics, spacing, Text } from "@repo/native-ui";
import { Pressable, StyleSheet, View } from "react-native";

/** Line tabs: the editorial filter row, never a pill control. */
export function Segments<T extends string>({
  value,
  options,
  onChange,
  centered = false,
}: {
  centered?: boolean;
  value: T;
  options: { value: T; label: string; count?: number; alert?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={[styles.row, centered && styles.centered]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              haptics.selection();
              onChange(option.value);
            }}
            style={[styles.tab, active && styles.active]}
          >
            <Text
              variant="subheadline"
              weight={active ? "semibold" : "regular"}
              tone={active ? "primary" : "secondary"}
            >
              {option.label}
              {option.count ? (
                <Text
                  variant="footnote"
                  tone={option.alert ? "destructive" : "tertiary"}
                  figure
                >
                  {` ${option.count}`}
                </Text>
              ) : null}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    marginBottom: spacing.md,
  },
  centered: { justifyContent: "center", gap: spacing.xl },
  tab: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderColor: "transparent",
    marginBottom: -StyleSheet.hairlineWidth,
  },
  active: { borderColor: colors.label },
});
