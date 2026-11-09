import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Text } from "./text";
import { colors, fonts, radius, spacing } from "./theme";

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** A hairline pill on the page, as in the phone's filter row. */
  outline?: boolean;
  /** Drawn after the label, e.g. a chevron for a picker. */
  trailing?: ReactNode;
}

/** A toggle in a row of choices: genres, seasons, the map's film/series filter. */
export function Chip({
  label,
  selected,
  onPress,
  disabled,
  outline,
  trailing,
}: ChipProps) {
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
        outline && !selected ? styles.outline : null,
        {
          backgroundColor: selected
            ? colors.paper
            : outline
              ? "transparent"
              : colors.fill,
          opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        variant="subheadline"
        numberOfLines={1}
        style={{
          flexShrink: 1,
          color: selected ? colors.ink : colors.paper,
          fontFamily: selected ? fonts.bold : fonts.regular,
        }}
      >
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    maxWidth: "100%",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 34,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  outline: { borderWidth: 1, borderColor: colors.faint },
});
