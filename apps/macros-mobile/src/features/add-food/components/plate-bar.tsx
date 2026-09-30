import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { energyLabel, formatEnergy } from "@/lib/format";
import {
  Button,
  colors,
  Hairline,
  Icon,
  InlineNotice,
  spacing,
  Text,
} from "@/ui";
import { useCommitPlate } from "../plate-commit";
import { type PlateItem, plateTotals, usePlate } from "../plate-store";
import { useZone } from "../target";

type EnergyUnit = ReturnType<typeof useZone>["energyUnit"];

function foods(count: number) {
  return `${count} ${count === 1 ? "food" : "foods"}`;
}

/**
 * What is on the plate and the button that logs it, in one row. Rendered in
 * content rather than a toolbar, so it stays put while the search field has
 * the keyboard and on screens that have no toolbar at all.
 */
export function PlateBar({
  items,
  energyUnit,
  committing,
  failure,
  onOpen,
  onLog,
  onClearFailure,
}: {
  items: readonly PlateItem[];
  energyUnit: EnergyUnit;
  committing: boolean;
  failure: string | null;
  onOpen: () => void;
  onLog: () => void;
  onClearFailure: () => void;
}) {
  if (items.length === 0 && !failure) return null;
  const totals = plateTotals(items);
  const energy = `${formatEnergy(totals.calories, energyUnit)} ${energyLabel(energyUnit)}`;
  const macros = `${Math.round(totals.protein)}P ${Math.round(totals.carbs)}C ${Math.round(totals.fat)}F`;

  return (
    <View style={styles.wrap}>
      {items.length > 0 ? (
        <View style={styles.row}>
          <Pressable
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={`Plate, ${foods(items.length)}, ${energy}`}
            accessibilityHint="Opens the plate"
            style={({ pressed }) => [styles.summary, pressed && styles.pressed]}
          >
            <View style={styles.badge}>
              <Icon name="utensils" size={16} color={colors.onTint} />
            </View>
            <View style={styles.text}>
              <Text variant="subheadline" weight="semibold" figure>
                {foods(items.length)} · {energy}
              </Text>
              <Text variant="caption1" tone="secondary" figure>
                {macros}
              </Text>
            </View>
          </Pressable>
          <Button
            label="Log"
            size="small"
            block={false}
            loading={committing}
            onPress={onLog}
          />
        </View>
      ) : null}
      {failure ? (
        <InlineNotice
          tone="error"
          message={failure}
          onDismiss={onClearFailure}
        />
      ) : null}
      <Hairline />
    </View>
  );
}

/** The plate bar for screens outside the hub: Today and the Log. */
export function PendingPlateBar() {
  const items = usePlate();
  const zone = useZone();
  const { commit, committing, failure, clearFailure } = useCommitPlate(
    () => undefined,
  );
  return (
    <PlateBar
      items={items}
      energyUnit={zone.energyUnit}
      committing={committing}
      failure={failure}
      // The hub's stack starts at its index, so the plate opens over it.
      onOpen={() => router.push("/add-food/plate")}
      onLog={() => void commit(items)}
      onClearFailure={clearFailure}
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  summary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tint,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  pressed: {
    opacity: 0.6,
  },
});
