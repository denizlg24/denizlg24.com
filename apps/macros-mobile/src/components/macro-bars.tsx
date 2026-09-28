import { StyleSheet, View } from "react-native";
import { formatInteger } from "@/lib/format";
import { Meter, macroColors, spacing, Text } from "@/ui";

export interface MacroAmounts {
  protein: number;
  carbs: number;
  fat: number;
}

/** A plan can set some macro targets and leave others open. */
export type MacroTargets = Record<keyof MacroAmounts, number | null>;

const MACROS = [
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
] as const;

/** Three columns: figure over target, a thin meter underneath. */
export function MacroBars({
  consumed,
  targets,
}: {
  consumed: MacroAmounts;
  targets: MacroTargets | null;
}) {
  return (
    <View style={styles.row}>
      {MACROS.map(({ key, label }) => {
        const target = targets?.[key] ?? null;
        return (
          <View key={key} style={styles.column}>
            <Text variant="caption1" tone="secondary" eyebrow>
              {label}
            </Text>
            <View style={styles.figure}>
              <Text variant="headline" figure>
                {formatInteger(consumed[key])}
              </Text>
              <Text variant="footnote" tone="secondary" figure>
                {target !== null ? `/ ${formatInteger(target)} g` : "g"}
              </Text>
            </View>
            <Meter
              progress={target ? consumed[key] / target : 0}
              color={macroColors[key]}
              overflowColor={macroColors.overflow}
            />
          </View>
        );
      })}
    </View>
  );
}

/** "P 32 · C 40 · F 12" with coloured initials, for list rows. */
export function MacroInline({ protein, carbs, fat }: MacroAmounts) {
  return (
    <View style={styles.inline}>
      {(
        [
          ["P", protein, macroColors.protein],
          ["C", carbs, macroColors.carbs],
          ["F", fat, macroColors.fat],
        ] as const
      ).map(([letter, value, color]) => (
        <Text key={letter} variant="footnote" tone="secondary" figure>
          <Text variant="footnote" weight="semibold" style={{ color }}>
            {letter}
          </Text>{" "}
          {formatInteger(value)}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  column: {
    flex: 1,
    gap: spacing.xs,
  },
  figure: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
  },
  inline: {
    flexDirection: "row",
    gap: spacing.md,
  },
});
