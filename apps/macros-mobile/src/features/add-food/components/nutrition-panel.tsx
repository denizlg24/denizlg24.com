import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useProfile } from "@/api/profile";
import { MacroBars } from "@/components/macro-bars";
import {
  type EnergyUnit,
  energyLabel,
  formatEnergy,
  formatInteger,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  colors,
  Hairline,
  Icon,
  Meter,
  macroColors,
  Section,
  spacing,
  Text,
} from "@/ui";
import {
  energySplit,
  type MacroTargets,
  nutritionBreakdown,
} from "../nutrition";

/** Energy and macros for the chosen amount, measured against today's targets. */
export function AmountNutrition({
  nutrients,
  targets,
  energyUnit,
}: {
  nutrients: Record<string, number>;
  targets: MacroTargets | null;
  energyUnit: EnergyUnit;
}) {
  const calories = nutrients.calories ?? 0;
  const split = energySplit(nutrients);
  const macroTargets =
    targets &&
    targets.protein != null &&
    targets.carbs != null &&
    targets.fat != null
      ? { protein: targets.protein, carbs: targets.carbs, fat: targets.fat }
      : null;
  const calorieShare =
    targets?.calories != null && targets.calories > 0
      ? `${formatInteger((calories / targets.calories) * 100)}% of ${formatEnergy(targets.calories, energyUnit)} ${energyLabel(energyUnit)}`
      : null;

  return (
    <View style={styles.amount}>
      <View style={styles.energy}>
        <View style={styles.energyFigure}>
          <Text variant="largeTitle" figure>
            {formatEnergy(calories, energyUnit)}
          </Text>
          <Text variant="subheadline" tone="secondary">
            {energyLabel(energyUnit)}
          </Text>
        </View>
        <Text variant="footnote" tone="secondary" figure>
          {calorieShare ??
            `${split.protein}% protein · ${split.carbs}% carbs · ${split.fat}% fat`}
        </Text>
      </View>
      {calorieShare ? (
        <Meter
          progress={targets?.calories ? calories / targets.calories : 0}
          color={macroColors.calories}
          overflowColor={macroColors.overflow}
        />
      ) : null}
      <MacroBars
        consumed={{
          protein: nutrients.protein ?? 0,
          carbs: nutrients.carbs ?? 0,
          fat: nutrients.fat ?? 0,
        }}
        targets={macroTargets}
      />
    </View>
  );
}

export function NutritionBreakdown({
  nutrients,
  targets,
  today,
}: {
  nutrients: Record<string, number>;
  targets: MacroTargets | null;
  today: string;
}) {
  const [open, setOpen] = useState(true);
  const profile = useProfile();
  const sections = nutritionBreakdown(nutrients, targets, {
    sex: profile.data?.sex,
    birthDate: profile.data?.birthDate,
    today,
  });
  if (sections.length === 0) return null;
  const count = sections.reduce(
    (total, section) => total + section.rows.length,
    0,
  );

  return (
    <View>
      <Pressable
        onPress={() => {
          haptics.selection();
          setOpen((current) => !current);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}
      >
        <Text variant="body" weight="semibold" style={styles.flex}>
          Full nutrition
        </Text>
        <Text variant="subheadline" tone="secondary" figure>
          {count} nutrients
        </Text>
        <Icon
          name={open ? "chevron-up" : "chevron-down"}
          size={13}
          weight="semibold"
          color={colors.tertiaryLabel}
        />
      </Pressable>
      <Hairline />
      {open ? (
        <View style={styles.sections}>
          {sections.map((section) => (
            <Section key={section.title} title={section.title}>
              {section.rows.map((row) => (
                <View
                  key={row.key}
                  style={styles.nutrient}
                  accessible
                  accessibilityLabel={`${row.label} ${row.amount} ${row.unit}${
                    row.progress != null
                      ? `, ${formatInteger(row.progress * 100)}% of daily ${row.isLimit ? "limit" : "value"}`
                      : ""
                  }`}
                >
                  <View style={styles.nutrientLine}>
                    <Text variant="subheadline" style={styles.flex}>
                      {row.label}
                    </Text>
                    <Text variant="subheadline" tone="secondary" figure>
                      {row.amount} {row.unit}
                    </Text>
                    <Text
                      variant="footnote"
                      tone="tertiary"
                      figure
                      style={styles.percent}
                    >
                      {row.progress != null
                        ? `${formatInteger(row.progress * 100)}%`
                        : ""}
                    </Text>
                  </View>
                  {row.progress != null ? (
                    <Meter
                      progress={row.progress}
                      color={row.color}
                      overflowColor={row.overflowColor}
                    />
                  ) : null}
                </View>
              ))}
            </Section>
          ))}
          <Text variant="footnote" tone="secondary">
            Percentages use your targets for energy and macros, and dietary
            reference intakes for your sex and age for everything else.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  amount: {
    gap: spacing.lg,
  },
  energy: {
    gap: spacing.xxs,
  },
  energyFigure: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
  },
  disclosure: {
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
  sections: {
    gap: spacing.xl,
    paddingTop: spacing.lg,
  },
  nutrient: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  nutrientLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  percent: {
    minWidth: 40,
    textAlign: "right",
  },
});
