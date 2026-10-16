import type { LiveMode } from "@modules/location-native";
import { colors, haptics, radius, spacing, Text } from "@repo/native-ui";
import { Pressable, StyleSheet, View } from "react-native";

const MODES: { value: LiveMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "auto", label: "Moving" },
  { value: "on", label: "Always" },
];

export function LiveModePicker({
  value,
  onChange,
}: {
  value: LiveMode;
  onChange: (mode: LiveMode) => void;
}) {
  return (
    <View style={styles.track} accessibilityRole="radiogroup">
      {MODES.map((mode) => {
        const selected = mode.value === value;
        return (
          <Pressable
            key={mode.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              haptics.selection();
              onChange(mode.value);
            }}
            style={[styles.segment, selected && styles.selected]}
          >
            <Text
              variant="subheadline"
              weight={selected ? "semibold" : "regular"}
              tone={selected ? "primary" : "secondary"}
            >
              {mode.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: colors.tertiaryFill,
    borderRadius: radius.sm,
    padding: spacing.xxs,
    marginVertical: spacing.sm,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm - 2,
  },
  selected: { backgroundColor: colors.background },
});
