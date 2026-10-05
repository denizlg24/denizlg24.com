import { router, Stack } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFoodLogDay } from "@/api/food-log";
import { energyLabel, formatDayLabel, formatEnergy } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { formatTimeOfDay } from "@/lib/log-time";
import {
  EmptyState,
  gutter,
  Hairline,
  InlineNotice,
  Screen,
  spacing,
  Text,
  useResolvedColors,
} from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { toolbarText, useBottomToolbarInset } from "@/ui/toolbar";
import { FoodRow } from "./components/food-row";
import { PlateTotals } from "./components/plate-totals";
import { useCommitPlate } from "./plate-commit";
import {
  addToPlate,
  clearPlate,
  type PlateItem,
  plateTotals,
  removeFromPlate,
  usePlate,
} from "./plate-store";
import { describeAmount } from "./serving";
import { useTargets, useZone } from "./target";

function addTotals(
  a: ReturnType<typeof plateTotals>,
  b: ReturnType<typeof plateTotals>,
) {
  return {
    calories: a.calories + b.calories,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
  };
}

/** Leaves the whole add-food hub, from the plate pushed inside it. */
function closeHub() {
  router.dismissAll();
  router.back();
}

export function PlateScreen() {
  const items = usePlate();
  const zone = useZone();
  const targets = useTargets(zone.today);
  const resolved = useResolvedColors();
  const toolbarInset = useBottomToolbarInset();
  const { commit } = useCommitPlate(closeHub);
  const [removed, setRemoved] = useState<PlateItem[] | null>(null);

  const days = new Set(items.map((item) => item.input.logDate ?? zone.today));
  const mixed = days.size > 1;
  const plateDay = [...days][0] ?? zone.today;
  // Where the day lands once the plate is logged; only meaningful while the
  // plate is staged for one day.
  const dayLog = useFoodLogDay(plateDay);
  const after =
    !mixed && dayLog.data
      ? addTotals(dayLog.data.totals, plateTotals(items))
      : null;
  const recipeReady = items.some((item) => item.kind === "food");

  function placementOf(item: PlateItem): string | null {
    const day =
      item.input.logDate && item.input.logDate !== zone.today
        ? formatDayLabel(item.input.logDate, zone.today)
        : null;
    const time =
      mixed && item.input.eatenAt
        ? formatTimeOfDay(item.input.eatenAt, zone.timeZone)
        : null;
    return [day, time].filter(Boolean).join(" ") || null;
  }

  function remove(gone: PlateItem[]) {
    haptics.warning();
    removeFromPlate(gone.map((item) => item.uid));
    setRemoved(gone);
  }

  function edit(item: PlateItem) {
    const pathname = item.kind === "food" ? "/food/[id]" : "/recipe-log/[id]";
    const id =
      item.kind === "food" ? item.input.sourceItemId : item.input.recipeId;
    router.push({ pathname, params: { id, plate: item.uid, name: item.name } });
  }

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu
          icon={glyphs.ellipsis}
          iconRenderingMode="template"
          accessibilityLabel="Plate actions"
          hidden={items.length === 0}
        >
          <Stack.Toolbar.MenuAction
            icon={glyphs.trash}
            iconRenderingMode="template"
            destructive
            onPress={() => {
              const all = items;
              clearPlate();
              remove(all);
            }}
          >
            Clear plate
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <Stack.Toolbar placement="bottom">
        {toolbarText({
          accessibilityLabel: "Save the plate as a recipe",
          disabled: !recipeReady,
          onPress: () => router.push("/add-food/save-recipe"),
          children: "Recipe",
        })}
        <Stack.Toolbar.Spacer />
        {toolbarText({
          variant: "prominent",
          tintColor: resolved.label,
          style: { color: resolved.background, fontWeight: "600" },
          disabled: items.length === 0,
          onPress: () => commit(items),
          children: items.length > 0 ? `Log (${items.length})` : "Log",
        })}
      </Stack.Toolbar>

      <Screen
        bleed
        contentContainerStyle={[
          styles.content,
          toolbarInset > 0 && { paddingBottom: toolbarInset },
        ]}
      >
        {removed ? (
          <View style={styles.inset}>
            <InlineNotice
              tone="info"
              message={
                removed.length === 1
                  ? `Removed ${removed[0]?.name ?? "food"}.`
                  : `Cleared ${removed.length} foods.`
              }
              action={{
                label: "Undo",
                onPress: () => {
                  for (const item of removed) addToPlate(item);
                  haptics.selection();
                  setRemoved(null);
                },
              }}
              onDismiss={() => setRemoved(null)}
            />
          </View>
        ) : null}

        {items.length === 0 ? (
          <EmptyState
            icon="utensils"
            title="Your plate is empty"
            message="Tap + on any food to put it here, then log everything together."
          />
        ) : (
          <>
            <PlateTotals
              totals={plateTotals(items)}
              targets={targets}
              energyUnit={zone.energyUnit}
            />
            {after ? (
              <Text
                variant="footnote"
                tone="secondary"
                figure
                style={styles.after}
              >
                {plateDay === zone.today
                  ? "Today"
                  : formatDayLabel(plateDay, zone.today)}{" "}
                after logging: {formatEnergy(after.calories, zone.energyUnit)}
                {targets?.calories != null
                  ? ` / ${formatEnergy(targets.calories, zone.energyUnit)}`
                  : ""}{" "}
                {energyLabel(zone.energyUnit)} · {Math.round(after.protein)}P{" "}
                {Math.round(after.fat)}F {Math.round(after.carbs)}C
              </Text>
            ) : null}
            <Hairline />
            {mixed ? (
              <Text variant="footnote" tone="secondary" style={styles.inset}>
                Staged for different days
              </Text>
            ) : null}
            <View style={styles.rows}>
              {items.map((item, index) => {
                const amount = describeAmount({
                  servingLabel: item.servingLabel,
                  servingsConsumed: item.input.servingsConsumed ?? 1,
                  enteredQuantity:
                    item.kind === "food" ? item.input.enteredQuantity : null,
                  enteredUnit:
                    item.kind === "food" ? item.input.enteredUnit : null,
                });
                const placement = placementOf(item);
                return (
                  <FoodRow
                    key={item.uid}
                    row={{
                      key: `plate:${item.uid}`,
                      name: item.name,
                      brand: item.brand,
                      iconKey: item.iconKey,
                      entryType: item.kind,
                      amount: placement ? `${amount} · ${placement}` : amount,
                      macros: item.macros,
                    }}
                    energyUnit={zone.energyUnit}
                    onPress={() => edit(item)}
                    onRemove={() => remove([item])}
                    separator={index < items.length - 1}
                  />
                );
              })}
            </View>
            <Hairline />
          </>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 0,
  },
  inset: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
  },
  after: {
    paddingHorizontal: gutter,
    paddingBottom: spacing.md,
  },
  rows: {
    paddingHorizontal: gutter,
  },
});
