import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "./icon";
import type * as Shared from "./stepper";
import { Text } from "./text";
import { colors, radius, spacing } from "./theme";

export type { StepperProps } from "./stepper";

// Material has no stepper; this is SwiftUI's shape in the app's own parts.
export const Stepper: typeof Shared.Stepper = ({
  label,
  value,
  step,
  min,
  max,
  onValueChange,
  hideLabel = false,
  style,
}) => {
  // Rounded to the step's precision so 0.5 steps never drift to 2.4999.
  const move = (direction: 1 | -1) => {
    const next = Math.round((value + direction * step) / step) * step;
    onValueChange(Math.min(max, Math.max(min, next)));
  };

  return (
    <View style={[styles.row, style]}>
      {hideLabel ? null : (
        <Text variant="body" style={styles.label}>
          {label}
        </Text>
      )}
      <View style={styles.buttons}>
        <StepButton
          icon="minus"
          label={`Decrease ${label}`}
          disabled={value <= min}
          onPress={() => move(-1)}
        />
        <View style={styles.divider} />
        <StepButton
          icon="plus"
          label={`Increase ${label}`}
          disabled={value >= max}
          onPress={() => move(1)}
        />
      </View>
    </View>
  );
};

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "minus" | "plus";
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
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon name={icon} size={17} weight="medium" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  label: {
    flex: 1,
  },
  buttons: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.tertiaryFill,
  },
  button: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    backgroundColor: colors.separator,
  },
  pressed: {
    opacity: 0.5,
  },
  disabled: {
    opacity: 0.3,
  },
});
