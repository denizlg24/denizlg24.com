import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
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
import { formatDecimal, formatInteger } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  colors,
  Flash,
  Icon,
  InlineNotice,
  Section,
  spacing,
  Text,
} from "@/ui";

const UNDO_WINDOW_MS = 6000;

/** Water drunk today with one-tap quick adds, so it needn't wait for Body. */
export function WaterSection({
  logDate,
  onOpen,
}: {
  /** The server's day — what a drink is recorded against. */
  logDate: string;
  onOpen: () => void;
}) {
  const ounces = useProfile().data?.weightUnit === "lb";
  const overview = useBodyOverview();
  const addHydration = useAddHydration();
  const [flash, setFlash] = useState<number | null>(null);
  const removeHydration = useRemoveHydration();
  const [failed, setFailed] = useState<string | null>(null);
  const [last, setLast] = useState<
    (HydrationRemoval & { label: string }) | null
  >(null);

  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => setLast(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [last]);

  const drunkMl =
    overview.data?.hydration.find((entry) => entry.logDate === logDate)
      ?.volumeMl ?? 0;
  const amount = ounces
    ? formatDecimal(drunkMl / ML_PER_OZ)
    : formatInteger(drunkMl);
  const unit = ounces ? "fl oz" : "ml";
  const quickAdds = ounces ? [8, 16] : [250, 500];

  function drink(volume: number) {
    haptics.light();
    setFailed(null);
    setLast(null);
    setFlash(Date.now());
    const volumeUnit = ounces ? "oz" : "ml";
    addHydration.mutate(
      { logDate, volume, unit: volumeUnit },
      {
        onSuccess: ({ hydration }) =>
          setLast({
            id: hydration.id,
            logDate,
            volumeMl: hydrationMl(volume, volumeUnit),
            label: `Added ${volume} ${unit}`,
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

  return (
    <Section title="Water" action={{ label: "Body", onPress: onOpen }}>
      <View style={styles.row}>
        <Flash token={flash} style={styles.amount}>
          <Icon name="droplet" size={20} color={colors.secondaryLabel} />
          <Text variant="title3" figure>
            {amount}
          </Text>
          <Text variant="footnote" tone="secondary">
            {unit}
          </Text>
        </Flash>
        {quickAdds.map((volume) => (
          <Pressable
            key={volume}
            onPress={() => drink(volume)}
            disabled={!overview.data}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Add ${volume} ${ounces ? "fluid ounces" : "millilitres"} of water`}
            style={({ pressed }) => [styles.add, pressed && styles.pressed]}
          >
            <Text variant="subheadline" weight="semibold" figure>
              +{volume}
            </Text>
          </Pressable>
        ))}
      </View>
      {failed ? (
        <InlineNotice
          message={`Couldn’t update water. ${failed}`}
          onDismiss={() => setFailed(null)}
        />
      ) : last ? (
        <InlineNotice
          tone="info"
          message={last.label}
          action={{ label: "Undo", onPress: undo }}
        />
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  amount: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  add: {
    minWidth: 64,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tertiaryFill,
  },
  pressed: {
    opacity: 0.6,
  },
});
