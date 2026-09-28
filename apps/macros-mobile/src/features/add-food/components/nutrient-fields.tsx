import { MenuView } from "@expo/ui/community/menu";
import type { NutrientKey } from "@repo/macros-core/foods/nutrients";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { haptics } from "@/lib/haptics";
import {
  colors,
  figureStyle,
  Hairline,
  Icon,
  spacing,
  Text,
  typeScale,
} from "@/ui";
import {
  CORE_NUTRIENTS,
  type FoodFormState,
  fieldLabel,
  fieldUnit,
  filledCount,
  MORE_NUTRIENT_GROUPS,
  withDisplay,
} from "../food-form";

const LOW_CONFIDENCE = 0.7;

type UnitMenu = {
  actions: { id: string; title: string; state: "on" | "off" }[];
  onSelect: (id: string) => void;
};

function unitMenuFor(
  key: NutrientKey,
  state: FoodFormState,
  onChange: (next: FoodFormState) => void,
): UnitMenu | null {
  if (key === "calories") {
    return {
      actions: [
        {
          id: "kcal",
          title: "Kilocalories (kcal)",
          state: state.energyUnit === "kcal" ? "on" : "off",
        },
        {
          id: "kj",
          title: "Kilojoules (kJ)",
          state: state.energyUnit === "kj" ? "on" : "off",
        },
      ],
      onSelect: (id) =>
        onChange(
          withDisplay(state, { energyUnit: id === "kj" ? "kj" : "kcal" }),
        ),
    };
  }
  if (key === "sodium") {
    return {
      actions: [
        {
          id: "salt-g",
          title: "Salt (g)",
          state: state.sodiumUnit === "salt-g" ? "on" : "off",
        },
        {
          id: "mg",
          title: "Sodium (mg)",
          state: state.sodiumUnit === "mg" ? "on" : "off",
        },
      ],
      onSelect: (id) =>
        onChange(
          withDisplay(state, { sodiumUnit: id === "mg" ? "mg" : "salt-g" }),
        ),
    };
  }
  return null;
}

function NutrientRow({
  nutrientKey,
  nested = false,
  state,
  onChange,
}: {
  nutrientKey: NutrientKey;
  nested?: boolean;
  state: FoodFormState;
  onChange: (next: FoodFormState) => void;
}) {
  const label = fieldLabel(nutrientKey, state);
  const unit = fieldUnit(nutrientKey, state);
  const confidence = state.confidence[nutrientKey];
  const uncertain = confidence != null && confidence < LOW_CONFIDENCE;
  const menu = unitMenuFor(nutrientKey, state, onChange);

  const unitLabel = (
    <View style={styles.unit}>
      <Text variant="body" tone="secondary">
        {unit}
      </Text>
      {menu ? (
        <Icon
          name="chevrons-up-down"
          size={11}
          weight="semibold"
          color={colors.tertiaryLabel}
        />
      ) : null}
    </View>
  );

  return (
    <View>
      <View style={[styles.row, nested && styles.nested]}>
        <View style={styles.label}>
          <Text
            variant="body"
            tone={nested ? "secondary" : "primary"}
            numberOfLines={2}
          >
            {label}
          </Text>
          {uncertain ? (
            <Text variant="caption1" tone="warning">
              Check this value
            </Text>
          ) : null}
        </View>
        <TextInput
          value={state.values[nutrientKey] ?? ""}
          onChangeText={(text) =>
            onChange({
              ...state,
              values: { ...state.values, [nutrientKey]: text },
              confidence: { ...state.confidence, [nutrientKey]: undefined },
            })
          }
          keyboardType="decimal-pad"
          placeholder="—"
          placeholderTextColor={colors.placeholder}
          accessibilityLabel={`${label} in ${unit}`}
          style={styles.input}
        />
        {menu ? (
          <MenuView
            title="Unit"
            actions={menu.actions}
            onPressAction={({ nativeEvent }) => {
              haptics.selection();
              menu.onSelect(nativeEvent.event);
            }}
          >
            {unitLabel}
          </MenuView>
        ) : (
          unitLabel
        )}
      </View>
      <Hairline inset={nested ? spacing.lg : 0} />
    </View>
  );
}

export function CoreNutrientFields({
  state,
  onChange,
}: {
  state: FoodFormState;
  onChange: (next: FoodFormState) => void;
}) {
  return (
    <View>
      {CORE_NUTRIENTS.map((nutrient) => (
        <NutrientRow
          key={nutrient.key}
          nutrientKey={nutrient.key}
          nested={nutrient.nested}
          state={state}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

export function MoreNutrientFields({
  state,
  onChange,
}: {
  state: FoodFormState;
  onChange: (next: FoodFormState) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  return (
    <View>
      {MORE_NUTRIENT_GROUPS.map((group) => {
        const expanded = open.has(group.title);
        const filled = filledCount(state, group.keys);
        return (
          <View key={group.title}>
            <Pressable
              onPress={() => {
                haptics.selection();
                setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(group.title)) next.delete(group.title);
                  else next.add(group.title);
                  return next;
                });
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              style={({ pressed }) => [styles.group, pressed && styles.pressed]}
            >
              <Text variant="body" style={styles.flex}>
                {group.title}
              </Text>
              <Text variant="subheadline" tone="secondary" figure>
                {filled > 0
                  ? `${filled} of ${group.keys.length}`
                  : `${group.keys.length}`}
              </Text>
              <Icon
                name={expanded ? "chevron-up" : "chevron-down"}
                size={13}
                weight="semibold"
                color={colors.tertiaryLabel}
              />
            </Pressable>
            <Hairline />
            {expanded
              ? group.keys.map((key) => (
                  <NutrientRow
                    key={key}
                    nutrientKey={key}
                    nested
                    state={state}
                    onChange={onChange}
                  />
                ))
              : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.xs,
  },
  nested: {
    paddingLeft: spacing.lg,
  },
  label: {
    flex: 1,
    gap: spacing.xxs,
  },
  input: {
    ...typeScale.body,
    ...figureStyle,
    minWidth: 84,
    textAlign: "right",
    color: colors.label,
    paddingVertical: spacing.sm,
  },
  unit: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    minWidth: 44,
  },
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.md,
  },
  pressed: {
    opacity: 0.6,
  },
  flex: {
    flex: 1,
  },
});
