import type { MacrosFoodSearchItem } from "@repo/schemas/macros";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFoodDetail } from "@/api/foods";
import { parseAmount } from "@/features/add-food/amount-input";
import {
  AmountBar,
  type AmountValue,
} from "@/features/add-food/components/amount-bar";
import {
  buildServingOptions,
  findOption,
  foodServingFrom,
  formatQuantityInput,
  initialAmount,
  servingsFor,
} from "@/features/add-food/serving";
import { Button, colors, InlineNotice, spacing, Text } from "@/ui";

/** Uses the logging sheet's keypad and measured units for recipe ingredients. */
export function IngredientAmount({
  food,
  servings = 1,
  label,
  onSave,
  onClose,
}: {
  food: MacrosFoodSearchItem;
  servings?: number;
  label: string;
  onSave: (servings: number) => void;
  onClose: () => void;
}) {
  const detail = useFoodDetail(food.id);
  const serving = useMemo(
    () =>
      detail.data
        ? buildServingOptions(foodServingFrom(detail.data.nutrition))
        : null,
    [detail.data],
  );
  return (
    <View collapsable={false} style={styles.container}>
      <Text variant="headline" style={styles.title}>
        {food.name}
      </Text>
      {serving ? (
        <IngredientKeypad
          key={food.id}
          serving={serving}
          servings={servings}
          label={label}
          onSave={onSave}
          onClose={onClose}
        />
      ) : (
        <View style={styles.loading}>
          {detail.isError ? (
            <>
              <InlineNotice message="Couldn’t load serving sizes. Try again to choose an amount." />
              <Button
                label="Try again"
                variant="tinted"
                size="regular"
                onPress={() => void detail.refetch()}
              />
            </>
          ) : (
            <ActivityIndicator color={colors.secondaryLabel} />
          )}
          <Button
            label="Cancel"
            variant="plain"
            size="regular"
            onPress={onClose}
          />
        </View>
      )}
    </View>
  );
}
function IngredientKeypad({
  serving,
  servings,
  label,
  onSave,
  onClose,
}: {
  serving: ReturnType<typeof buildServingOptions>;
  servings: number;
  label: string;
  onSave: (servings: number) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState<AmountValue>(() => {
    const start = initialAmount(serving, { servings });
    return {
      optionId: start.optionId,
      text: formatQuantityInput(start.quantity),
    };
  });
  const [open, setOpen] = useState(true);
  const quantity = parseAmount(value.text);
  const amount =
    quantity === null
      ? 0
      : servingsFor(quantity, findOption(serving, value.optionId));
  const valid = Number.isFinite(amount) && amount > 0 && amount <= 9999;
  return (
    <AmountBar
      serving={serving}
      value={value}
      onChange={setValue}
      open={open}
      onOpenChange={setOpen}
      secondary={{ label: "Cancel", onPress: onClose }}
      primary={{
        label,
        disabled: !valid,
        onPress: () => {
          if (valid) onSave(amount);
        },
      }}
    />
  );
}
const styles = StyleSheet.create({
  container: { backgroundColor: colors.background },
  title: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  loading: { padding: spacing.xl, gap: spacing.md },
});
