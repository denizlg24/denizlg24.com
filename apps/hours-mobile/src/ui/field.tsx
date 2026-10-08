import { forwardRef } from "react";
import {
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { Hairline } from "./section";
import { Text } from "./text";
import { colors, figureStyle, spacing, typeScale } from "./theme";

/** A labelled row with an inline input, separated by a hairline. */
export const Field = forwardRef<
  TextInput,
  TextInputProps & {
    label: string;
    figure?: boolean;
    containerStyle?: ViewStyle;
  }
>(function Field({ label, figure, containerStyle, style, ...rest }, ref) {
  return (
    <View style={containerStyle}>
      <View style={styles.row}>
        <Text variant="body" style={styles.label}>
          {label}
        </Text>
        <TextInput
          ref={ref}
          placeholderTextColor={colors.placeholder}
          {...rest}
          style={[
            typeScale.body,
            styles.input,
            { color: colors.label },
            figure && figureStyle,
            style,
          ]}
        />
      </View>
      <Hairline />
    </View>
  );
});

/** Commas and dots both read as the decimal mark. */
export function parseDecimal(value: string): number | null {
  const normalised = value.trim().replace(",", ".");
  if (normalised === "") return null;
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
  },
  label: { minWidth: 110 },
  input: { flex: 1, textAlign: "right", paddingVertical: spacing.sm },
});
