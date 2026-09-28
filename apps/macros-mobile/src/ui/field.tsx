import { forwardRef } from "react";
import {
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { Text } from "./text";
import { colors, figureStyle, hairline, spacing, typeScale } from "./theme";

export { parseDecimal } from "@/lib/numbers";

export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  /** Unit shown after the value, e.g. "kg" or "g". */
  suffix?: string;
  containerStyle?: ViewStyle;
}

/**
 * Label above, value on a hairline. Numeric fields render their value as a
 * figure so digits don't shift while typing.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(
  function TextField(
    {
      label,
      error,
      hint,
      suffix,
      containerStyle,
      style,
      keyboardType,
      ...rest
    },
    ref,
  ) {
    const numeric =
      keyboardType === "decimal-pad" ||
      keyboardType === "number-pad" ||
      keyboardType === "numeric";

    return (
      <View style={[styles.container, containerStyle]}>
        {label ? (
          <Text variant="footnote" tone="secondary" weight="medium">
            {label}
          </Text>
        ) : null}
        <View style={[styles.inputRow, error ? styles.errorRule : null]}>
          <TextInput
            ref={ref}
            placeholderTextColor={colors.placeholder}
            keyboardType={keyboardType}
            clearButtonMode={numeric ? "never" : "while-editing"}
            {...rest}
            style={[styles.input, numeric && figureStyle, style]}
          />
          {suffix ? (
            <Text variant="body" tone="secondary">
              {suffix}
            </Text>
          ) : null}
        </View>
        {error ? (
          <Text variant="footnote" tone="destructive">
            {error}
          </Text>
        ) : hint ? (
          <Text variant="footnote" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.separator,
  },
  errorRule: {
    borderBottomColor: colors.destructive,
  },
  input: {
    ...typeScale.body,
    flex: 1,
    color: colors.label,
    paddingVertical: spacing.md,
  },
});
