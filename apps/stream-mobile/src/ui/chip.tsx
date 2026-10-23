import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet } from "react-native";
import { Text } from "./text";
import { colors, fonts, radius, spacing } from "./theme";

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** The classic layout's bigger chip. */
  large?: boolean;
}

/** A toggle in a row of choices: genres, seasons, the map's film/series filter. */
export function Chip({ label, selected, onPress, disabled, large }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.chip,
        large ? styles.large : null,
        {
          backgroundColor: selected ? colors.paper : colors.fill,
          opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        variant={large ? "classicLabel" : "subheadline"}
        style={{
          color: selected ? colors.ink : colors.paper,
          fontFamily: selected ? fonts.bold : fonts.regular,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 34,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  large: { minHeight: 52, paddingHorizontal: spacing.xl },
});
