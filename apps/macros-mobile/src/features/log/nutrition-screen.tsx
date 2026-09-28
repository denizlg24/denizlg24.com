import { SegmentedControl } from "@expo/ui/community/segmented-control";
import { NUTRIENT_SECTIONS } from "@repo/macros-core/foods/who-guidelines";
import {
  MACRO_COLORS,
  macroColorFor,
  NUTRIENT_DEFAULT_COLOR,
  NUTRIENT_GROUP_COLORS,
} from "@repo/macros-core/macro-colors";
import type {
  MacrosNutrientRow,
  MacrosNutritionOverview,
  MacrosNutritionOverviewRange,
} from "@repo/schemas/macros";
import { useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useNutritionOverview } from "@/api/food-log";
import { useProfile } from "@/api/profile";
import { MacroBars } from "@/components/macro-bars";
import { errorMessage } from "@/lib/api";
import { deviceTimeZone, useToday } from "@/lib/day";
import {
  type EnergyUnit,
  energyLabel,
  formatDayLabel,
  formatEnergy,
  formatShortDate,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  colors,
  InlineNotice,
  Meter,
  macroColors,
  Screen,
  Section,
  spacing,
  Text,
  VStack,
} from "@/ui";
import { useSelectedDate } from "./selected-date";

const RANGES = [
  { label: "D", value: null },
  { label: "W", value: "1w" },
  { label: "M", value: "1m" },
  { label: "3M", value: "3m" },
  { label: "Y", value: "1y" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: MacrosNutritionOverviewRange | null;
}>;

const MACRO_KEYS = new Set(["calories", "protein", "carbs", "fat"]);

const SECTION_COLORS: Record<string, string> = {
  "Carb Breakdown": MACRO_COLORS.carbs,
  "Fat Breakdown": MACRO_COLORS.fat,
  "Protein & Amino Acids": MACRO_COLORS.protein,
  Vitamins: NUTRIENT_GROUP_COLORS.vitamins,
  Minerals: NUTRIENT_GROUP_COLORS.minerals,
  Other: NUTRIENT_GROUP_COLORS.other,
};

const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const smallAmount = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

function formatAmount(value: number): string {
  if (value >= 100) return amount.format(Math.round(value));
  return value >= 1 || value === 0
    ? amount.format(value)
    : smallAmount.format(value);
}

function colorFor(key: string, sectionColor: string): string {
  return Object.hasOwn(MACRO_COLORS, key) ? macroColorFor(key) : sectionColor;
}

function NutrientLine({
  row,
  color,
}: {
  row: MacrosNutrientRow;
  color: string;
}) {
  const hasTarget = row.target !== null && row.target > 0;
  const progress = hasTarget && row.target ? row.consumed / row.target : 0;
  const overLimit = row.upperLimit !== null && row.consumed > row.upperLimit;

  return (
    <View style={styles.line}>
      <View style={styles.lineText}>
        <Text variant="subheadline" style={styles.label} numberOfLines={1}>
          {row.label}
        </Text>
        <Text
          variant="footnote"
          figure
          tone={overLimit ? "warning" : "primary"}
        >
          {hasTarget && row.target
            ? `${formatAmount(row.consumed)} / ${formatAmount(row.target)} ${row.unit}`
            : `${formatAmount(row.consumed)} ${row.unit}`}
        </Text>
        <Text variant="footnote" tone="secondary" figure style={styles.percent}>
          {hasTarget ? `${Math.round(progress * 100)}%` : "—"}
        </Text>
      </View>
      {hasTarget ? (
        <Meter
          progress={progress}
          color={overLimit ? macroColors.overflow : color}
        />
      ) : null}
      {overLimit && row.upperLimit !== null ? (
        <Text variant="caption1" tone="warning" figure>
          {`Above the ${formatAmount(row.upperLimit)} ${row.unit} upper limit`}
        </Text>
      ) : null}
    </View>
  );
}

function OverviewBody({
  data,
  energyUnit,
}: {
  data: MacrosNutritionOverview;
  energyUnit: EnergyUnit;
}) {
  const byKey = new Map(data.nutrients.map((row) => [row.key, row]));
  const consumed = (key: string) => byKey.get(key)?.consumed ?? 0;
  const calories = consumed("calories");
  const calorieTarget = data.targets.calories;
  const macroTargets =
    data.targets.protein !== null &&
    data.targets.carbs !== null &&
    data.targets.fat !== null
      ? {
          protein: data.targets.protein,
          carbs: data.targets.carbs,
          fat: data.targets.fat,
        }
      : null;
  const unit = energyLabel(energyUnit);

  return (
    <VStack>
      <View style={styles.energy}>
        <View style={styles.energyFigure}>
          <Text variant="title1" figure>
            {formatEnergy(calories, energyUnit)}
          </Text>
          <Text variant="subheadline" tone="secondary" figure>
            {calorieTarget !== null
              ? `/ ${formatEnergy(calorieTarget, energyUnit)} ${unit}`
              : unit}
          </Text>
        </View>
        <Meter
          progress={calorieTarget ? calories / calorieTarget : 0}
          color={macroColors.calories}
          overflowColor={macroColors.overflow}
        />
        <MacroBars
          consumed={{
            protein: consumed("protein"),
            carbs: consumed("carbs"),
            fat: consumed("fat"),
          }}
          targets={macroTargets}
        />
      </View>

      {NUTRIENT_SECTIONS.map((section) => {
        const sectionColor =
          SECTION_COLORS[section.title] ?? NUTRIENT_DEFAULT_COLOR;
        const rows = section.keys
          .filter((key) => !MACRO_KEYS.has(key))
          .map((key) => byKey.get(key))
          .filter((row): row is MacrosNutrientRow => row !== undefined);
        if (rows.length === 0) return null;
        return (
          <Section key={section.title} title={section.title}>
            <View style={styles.rows}>
              {rows.map((row) => (
                <NutrientLine
                  key={row.key}
                  row={row}
                  color={colorFor(row.key, sectionColor)}
                />
              ))}
            </View>
          </Section>
        );
      })}
    </VStack>
  );
}

/** Micronutrients for the viewed day, or daily averages over a range. */
export function NutritionScreen() {
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const today = useToday(profile.data?.timezone ?? deviceTimeZone());
  const selected = useSelectedDate(today);
  const [index, setIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const choice = RANGES[index]?.value ?? null;
  const range: MacrosNutritionOverviewRange =
    choice ?? (selected === today ? "today" : "yesterday");
  const overview = useNutritionOverview(
    range,
    range === "yesterday" ? selected : undefined,
  );

  // Switching range keeps the last answer on screen, dimmed, instead of
  // blanking the page while the next one loads.
  const lastData = useRef<MacrosNutritionOverview | undefined>(undefined);
  if (overview.data) lastData.current = overview.data;
  const data = overview.data ?? lastData.current;
  const stale = overview.data === undefined && data !== undefined;

  const caption = !data
    ? " "
    : data.range === "today" || data.range === "yesterday"
      ? formatDayLabel(data.startDate, today)
      : `Daily average · ${data.daysCount} ${data.daysCount === 1 ? "day" : "days"} logged · ${formatShortDate(data.startDate)} – ${formatShortDate(data.endDate)}`;

  async function refresh() {
    setRefreshing(true);
    try {
      await overview.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Screen
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      stickyHeaderIndices={[0]}
    >
      <View style={styles.controls}>
        <SegmentedControl
          values={RANGES.map((option) => option.label)}
          selectedIndex={index}
          onChange={({ nativeEvent }) => {
            haptics.selection();
            setIndex(nativeEvent.selectedSegmentIndex);
          }}
        />
        <Text variant="footnote" tone="secondary" figure numberOfLines={2}>
          {caption}
        </Text>
        {overview.isError ? (
          <InlineNotice
            message={errorMessage(overview.error)}
            action={{
              label: "Try again",
              onPress: () => void overview.refetch(),
            }}
          />
        ) : null}
      </View>

      {data ? (
        <View style={stale ? styles.stale : undefined}>
          <OverviewBody data={data} energyUnit={energyUnit} />
        </View>
      ) : overview.isPending ? (
        <ActivityIndicator style={styles.loading} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  controls: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    backgroundColor: colors.background,
  },
  energy: {
    gap: spacing.md,
  },
  energyFigure: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
  },
  rows: {
    gap: spacing.lg,
    paddingTop: spacing.xs,
  },
  line: {
    gap: spacing.xs,
  },
  lineText: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  label: {
    flex: 1,
  },
  percent: {
    minWidth: 40,
    textAlign: "right",
  },
  stale: {
    opacity: 0.5,
  },
  loading: {
    paddingVertical: spacing.xxxl,
  },
});
