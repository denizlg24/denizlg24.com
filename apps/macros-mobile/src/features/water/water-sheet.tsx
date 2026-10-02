import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  type HydrationRemoval,
  hydrationMl,
  ML_PER_OZ,
  useAddHydration,
  useBodyOverview,
  useRemoveHydration,
} from "@/api/body";
import { useProfile } from "@/api/profile";
import { errorMessage } from "@/lib/api";
import { useToday } from "@/lib/day";
import { formatDecimal, formatInteger } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  Flash,
  InlineNotice,
  SheetHeader,
  sheetGutter,
  spacing,
  Text,
  waterColor,
} from "@/ui";
import { Glass } from "./glass";
import {
  amountAt,
  cupFills,
  formatCups,
  IMPERIAL_WATER,
  METRIC_WATER,
} from "./water";

const UNDO_WINDOW_MS = 6000;
const POUR_MS = 650;

/** Pour a glass, see it in cups, drink it. */
export function WaterSheet() {
  const insets = useSafeAreaInsets();
  const profile = useProfile();
  const today = useToday(profile.data?.timezone);
  const units =
    profile.data?.weightUnit === "lb" ? IMPERIAL_WATER : METRIC_WATER;
  const overview = useBodyOverview();
  const addHydration = useAddHydration();
  const removeHydration = useRemoveHydration();

  const [amount, setAmount] = useState(units.initial);
  const [pouring, setPouring] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [last, setLast] = useState<HydrationRemoval | null>(null);
  const picked = useRef(amount);

  useEffect(() => {
    picked.current = units.initial;
    setAmount(units.initial);
  }, [units]);

  useEffect(() => {
    if (!pouring) return;
    const timer = setTimeout(() => setPouring(false), POUR_MS);
    return () => clearTimeout(timer);
  }, [pouring]);

  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => setLast(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [last]);

  const drunkMl =
    overview.data?.hydration.find((entry) => entry.logDate === today)
      ?.volumeMl ?? 0;
  const drunk = units.unit === "oz" ? drunkMl / ML_PER_OZ : drunkMl;
  const figure = (value: number) =>
    units.unit === "oz" ? formatDecimal(value) : formatInteger(value);

  function choose(next: number) {
    if (next === picked.current) return;
    picked.current = next;
    haptics.selection();
    setAmount(next);
  }

  function step(direction: 1 | -1) {
    choose(
      Math.min(
        Math.max(amount + direction * units.step, units.step),
        units.capacity,
      ),
    );
  }

  function drink() {
    haptics.success();
    setFailed(null);
    setLast(null);
    setPouring(true);
    setFlash(Date.now());
    addHydration.mutate(
      { logDate: today, volume: amount, unit: units.unit },
      {
        onSuccess: ({ hydration }) =>
          setLast({
            id: hydration.id,
            logDate: today,
            volumeMl: hydrationMl(amount, units.unit),
          }),
        onError: (error) => {
          haptics.error();
          setFailed(errorMessage(error));
        },
      },
    );
  }

  function undo() {
    if (!last) return;
    haptics.selection();
    setLast(null);
    setFlash(Date.now());
    removeHydration.mutate(last, {
      onError: (error) => {
        haptics.error();
        setFailed(errorMessage(error));
      },
    });
  }

  const label = `${figure(amount)} ${units.label}`;

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, spacing.lg) },
      ]}
    >
      <SheetHeader title="Water" onClose={() => router.back()} />

      <View style={styles.pour}>
        <Glass
          fraction={pouring ? 0 : amount / units.capacity}
          onPick={(fraction) => choose(amountAt(fraction, units))}
          onStep={step}
          accessibilityLabel={`Amount, ${label}, ${formatCups(amount, units)}`}
        />
        <View style={styles.readout}>
          <Text variant="largeTitle" figure>
            {figure(amount)}
            <Text variant="title3" tone="secondary">
              {` ${units.label}`}
            </Text>
          </Text>
          <Text variant="headline" tone="secondary">
            {formatCups(amount, units)}
          </Text>
          <View style={styles.cups}>
            {cupFills(amount, units).map((fill, index) => (
              <Cup key={index} fill={fill} />
            ))}
          </View>
        </View>
      </View>

      <View style={styles.presets}>
        {units.presets.map((preset) => {
          const selected = preset === amount;
          return (
            <Pressable
              key={preset}
              onPress={() => choose(preset)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${figure(preset)} ${units.label}`}
              style={({ pressed }) => [
                styles.preset,
                selected && styles.presetSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text
                variant="subheadline"
                weight="semibold"
                figure
                tone={selected ? "onTint" : "primary"}
              >
                {figure(preset)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Button label={`Drink ${label}`} onPress={drink} />

      <Flash token={flash} style={styles.today}>
        <Text variant="footnote" tone="secondary" figure>
          Today {figure(drunk)} {units.label} · {formatCups(drunk, units)}
        </Text>
      </Flash>

      {failed ? (
        <InlineNotice
          message={`Couldn’t update water. ${failed}`}
          onDismiss={() => setFailed(null)}
        />
      ) : last ? (
        <InlineNotice
          tone="info"
          message={`Added ${label}`}
          action={{ label: "Undo", onPress: undo }}
        />
      ) : null}
    </View>
  );
}

/** One cup of the amount, filled as far as the amount reaches. */
function Cup({ fill }: { fill: number }) {
  return (
    <View style={styles.cup}>
      <View style={[styles.cupWater, { height: `${fill * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
    paddingHorizontal: sheetGutter,
    paddingTop: spacing.xl,
    backgroundColor: colors.background,
  },
  pour: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.xxl,
    paddingHorizontal: spacing.sm,
  },
  readout: {
    flex: 1,
    gap: spacing.xs,
    paddingBottom: spacing.xs,
  },
  cups: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  cup: {
    width: 18,
    height: 24,
    borderWidth: 1.5,
    borderTopWidth: 0,
    borderColor: colors.tertiaryLabel,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  cupWater: {
    backgroundColor: waterColor,
  },
  presets: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  preset: {
    flex: 1,
    minHeight: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tertiaryFill,
  },
  presetSelected: {
    backgroundColor: colors.label,
  },
  pressed: {
    opacity: 0.6,
  },
  today: {
    alignItems: "center",
  },
});
