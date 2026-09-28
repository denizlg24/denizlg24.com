import { MenuView } from "@expo/ui/community/menu";
import { StyleSheet, TextInput, View } from "react-native";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  figureStyle,
  hairline,
  Icon,
  parseDecimal,
  spacing,
  Text,
  typeScale,
} from "@/ui";
import {
  type AmountPreset,
  findOption,
  formatQuantityInput,
  quantityFor,
  type ServingOptions,
  servingsFor,
} from "../serving";

export interface AmountValue {
  optionId: string;
  text: string;
}

/**
 * Quantity on a decimal pad, the unit from a native menu, and one-tap
 * presets. Changing the unit converts the amount, so switching from
 * "1 slice" to grams reads "30 g" rather than "1 g".
 */
export function AmountEditor({
  serving,
  value,
  presets,
  onChange,
  autoFocus = false,
}: {
  serving: ServingOptions;
  value: AmountValue;
  presets: AmountPreset[];
  onChange: (next: AmountValue) => void;
  autoFocus?: boolean;
}) {
  const option = findOption(serving, value.optionId);
  const quantity = parseDecimal(value.text);

  function switchUnit(nextId: string) {
    if (nextId === option.id) return;
    const next = findOption(serving, nextId);
    haptics.selection();
    const text =
      quantity != null && quantity > 0
        ? formatQuantityInput(quantityFor(servingsFor(quantity, option), next))
        : value.text;
    onChange({ optionId: next.id, text });
  }

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <TextInput
          value={value.text}
          onChangeText={(text) => onChange({ optionId: option.id, text })}
          keyboardType="decimal-pad"
          selectTextOnFocus
          autoFocus={autoFocus}
          placeholder="0"
          placeholderTextColor={colors.placeholder}
          accessibilityLabel={`Amount in ${option.title}`}
          style={styles.input}
        />
        {serving.options.length > 1 ? (
          <MenuView
            title="Unit"
            actions={serving.options.map((candidate) => ({
              id: candidate.id,
              title: candidate.title,
              state: candidate.id === option.id ? "on" : "off",
            }))}
            onPressAction={({ nativeEvent }) => switchUnit(nativeEvent.event)}
          >
            <View
              style={styles.unit}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Unit: ${option.title}. Change unit`}
            >
              <Text variant="title3" numberOfLines={1}>
                {option.unit}
              </Text>
              <Icon
                name="chevrons-up-down"
                size={13}
                weight="semibold"
                color={colors.secondaryLabel}
              />
            </View>
          </MenuView>
        ) : (
          <Text variant="title3" numberOfLines={1}>
            {option.unit}
          </Text>
        )}
      </View>
      <View style={styles.presets}>
        {presets.map((preset) => (
          <Button
            key={preset.key}
            label={preset.label}
            variant="tinted"
            size="small"
            onPress={() => {
              haptics.selection();
              onChange({
                optionId: preset.optionId,
                text: formatQuantityInput(preset.quantity),
              });
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: colors.separator,
  },
  input: {
    ...typeScale.title1,
    ...figureStyle,
    flex: 1,
    color: colors.label,
    paddingVertical: spacing.sm,
  },
  unit: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    maxWidth: 200,
  },
  presets: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
});
