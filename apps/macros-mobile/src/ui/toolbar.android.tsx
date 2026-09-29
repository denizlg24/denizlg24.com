import { Stack } from "expo-router";
import type { ColorValue } from "react-native";
import { Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSinglePress } from "@/lib/use-single-press";
import { Text } from "./text";
import { colors, radius, spacing } from "./theme";
import type * as Shared from "./toolbar";

export type { ToolbarTextProps } from "./toolbar";

/** Height of the floating Material toolbar a bottom `Stack.Toolbar` becomes. */
const FLOATING_TOOLBAR_HEIGHT = 64;

export const toolbarText: typeof Shared.toolbarText = ({
  children,
  onPress,
  disabled,
  hidden,
  variant,
  tintColor,
  accessibilityLabel,
}) => (
  <Stack.Toolbar.View hidden={hidden}>
    <ToolbarTextButton
      label={children}
      onPress={onPress}
      disabled={disabled}
      prominent={variant === "prominent"}
      emphasized={variant === "done"}
      tint={tintColor}
      accessibilityLabel={accessibilityLabel}
    />
  </Stack.Toolbar.View>
);

export const useBottomToolbarInset: typeof Shared.useBottomToolbarInset =
  () => {
    const insets = useSafeAreaInsets();
    return FLOATING_TOOLBAR_HEIGHT + insets.bottom + spacing.lg;
  };

function ToolbarTextButton({
  label,
  onPress,
  disabled,
  prominent,
  emphasized,
  tint,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  prominent: boolean;
  emphasized: boolean;
  tint?: ColorValue;
  accessibilityLabel?: string;
}) {
  const press = useSinglePress(onPress);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={8}
      onPress={press}
      style={({ pressed }) => [
        styles.button,
        prominent && styles.prominent,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text
        variant="body"
        weight={prominent || emphasized ? "semibold" : "regular"}
        numberOfLines={1}
        style={{
          color: prominent ? colors.onTint : (tint ?? colors.tint),
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  prominent: {
    backgroundColor: colors.tint,
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.35,
  },
});
