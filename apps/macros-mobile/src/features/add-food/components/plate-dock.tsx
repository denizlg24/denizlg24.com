import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { energyLabel, formatEnergy } from "@/lib/format";
import { Button, colors, macroColors, radius, spacing, Text } from "@/ui";
import { type PlateItem, plateTotals } from "../plate-store";
import type { useZone } from "../target";

type EnergyUnit = ReturnType<typeof useZone>["energyUnit"];

/** Height the hub's list leaves free under its last row for the dock. */
export const PLATE_DOCK_CLEARANCE = 84;

/**
 * What is on the plate and the Log button, floating over the hub and riding
 * the keyboard up while a search is typed — the bottom toolbar it replaced
 * gave the whole row to the search field as soon as it was focused.
 */
export function PlateDock({
  items,
  energyUnit,
  onOpen,
  onLog,
}: {
  items: readonly PlateItem[];
  energyUnit: EnergyUnit;
  onOpen: () => void;
  onLog: () => void;
}) {
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({
    transform: [
      { translateY: -Math.max(0, keyboard.height.value - insets.bottom) },
    ],
  }));

  if (items.length === 0) return null;
  const totals = plateTotals(items);
  const count = `${items.length} ${items.length === 1 ? "food" : "foods"}`;
  const energy = `${formatEnergy(totals.calories, energyUnit)} ${energyLabel(energyUnit)}`;

  const content = (
    <View style={styles.row}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Plate, ${count}, ${energy}`}
        accessibilityHint="Opens the plate"
        style={({ pressed }) => [styles.summary, pressed && styles.pressed]}
      >
        <Text variant="subheadline" weight="semibold" figure numberOfLines={1}>
          {count} · {energy}
        </Text>
        <View style={styles.macros}>
          <Macro
            grams={totals.protein}
            letter="P"
            color={macroColors.protein}
          />
          <Macro grams={totals.carbs} letter="C" color={macroColors.carbs} />
          <Macro grams={totals.fat} letter="F" color={macroColors.fat} />
        </View>
      </Pressable>
      <Button
        label="Log"
        size="small"
        block={false}
        accessibilityLabel={`Log ${count}`}
        onPress={onLog}
        style={styles.log}
      />
    </View>
  );

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.anchor,
        { paddingBottom: Math.max(insets.bottom, spacing.md) },
        lift,
      ]}
    >
      {/* Solid, not glass: over the white list, glass had no visible edge
          and the dock read as one more row. */}
      <View style={styles.surface}>{content}</View>
    </Animated.View>
  );
}

function Macro({
  grams,
  letter,
  color,
}: {
  grams: number;
  letter: string;
  color: string;
}) {
  return (
    <View style={styles.macro}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="caption1" tone="secondary" figure>
        {Math.round(grams)}
        {letter}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
  },
  surface: {
    borderRadius: radius.pill,
    backgroundColor: colors.tertiaryBackground,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingLeft: spacing.xl,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
  },
  summary: {
    flex: 1,
    gap: spacing.xxs,
  },
  macros: {
    flexDirection: "row",
    gap: spacing.md,
  },
  macro: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pressed: {
    opacity: 0.6,
  },
  log: {
    minHeight: 40,
    paddingHorizontal: spacing.xl,
  },
});
