import type {
  MacrosAdherenceRule,
  MacrosEnergyBalancePoint,
  MacrosGoalProgress,
} from "@repo/schemas/macros";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import { type EnergyUnit, energyLabel, formatEnergy } from "@/lib/format";
import {
  Hairline,
  Meter,
  macroColors,
  Section,
  spacing,
  Text,
  useResolvedColors,
} from "@/ui";
import { type EnergyBar, summarizeEnergyBalance } from "./logic";

const CHART_HEIGHT = 52;
const BAR_GAP = 3;

function EnergyBars({
  bars,
  scale,
  today,
}: {
  bars: EnergyBar[];
  scale: number;
  today: string;
}) {
  const resolved = useResolvedColors();
  const [width, setWidth] = useState(0);
  const count = Math.max(1, bars.length);
  const barWidth = Math.max(2, (width - BAR_GAP * (count - 1)) / count);
  const y = (kcal: number) =>
    CHART_HEIGHT - Math.min(1, kcal / scale) * (CHART_HEIGHT - 2);

  return (
    <View style={styles.chart}>
      <View
        style={{ height: CHART_HEIGHT }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 ? (
          <Svg width={width} height={CHART_HEIGHT}>
            {bars.map((bar, index) => {
              const x = index * (barWidth + BAR_GAP);
              const top = y(bar.consumed);
              return (
                <Rect
                  key={bar.date}
                  x={x}
                  y={Math.min(top, CHART_HEIGHT - 1.5)}
                  width={barWidth}
                  height={Math.max(1.5, CHART_HEIGHT - top)}
                  rx={1.5}
                  fill={
                    bar.consumed <= 0
                      ? resolved.fill
                      : bar.over
                        ? macroColors.overflow
                        : macroColors.calories
                  }
                />
              );
            })}
            {bars.map((bar, index) =>
              bar.expenditure !== null ? (
                <Line
                  key={`${bar.date}-tdee`}
                  x1={index * (barWidth + BAR_GAP) - 0.5}
                  x2={index * (barWidth + BAR_GAP) + barWidth + 0.5}
                  y1={y(bar.expenditure)}
                  y2={y(bar.expenditure)}
                  stroke={resolved.label}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              ) : null,
            )}
          </Svg>
        ) : null}
      </View>
      <View style={styles.weekdays}>
        {bars.map((bar) => (
          <Text
            key={bar.date}
            variant="caption2"
            tone={bar.date === today ? "secondary" : "tertiary"}
            weight={bar.date === today ? "semibold" : undefined}
            align="center"
            style={styles.weekday}
          >
            {format(parseISO(bar.date), "EEEEE")}
          </Text>
        ))}
      </View>
    </View>
  );
}

const RULE_LABEL: Record<MacrosAdherenceRule, string> = {
  "at-most": "up to 10% over counts",
  "at-least": "up to 10% under counts",
  within: "within 10% counts",
};

function days(count: number) {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

function adherenceCaption(
  { daysTracked, daysOnTarget, totalDays, rule }: MacrosGoalProgress,
  hasPlan: boolean,
): string {
  if (!hasPlan) return "Tracked while a nutrition plan is active.";
  if (totalDays === 0) return "Counts from the plan’s first finished day.";
  if (daysTracked === 0) {
    return `No fully logged days in the past ${days(totalDays)}`;
  }
  const logged = `${daysOnTarget} of ${daysTracked} logged ${daysTracked === 1 ? "day" : "days"} on target`;
  const span = totalDays > daysTracked ? ` · past ${days(totalDays)}` : "";
  return `${logged}${span} · ${RULE_LABEL[rule]}`;
}

export interface EnergySectionProps {
  energyBalance: MacrosEnergyBalancePoint[];
  goalProgress: MacrosGoalProgress;
  hasPlan: boolean;
  energyUnit: EnergyUnit;
  today: string;
  onOpen: () => void;
}

export function EnergySection({
  energyBalance,
  goalProgress,
  hasPlan,
  energyUnit,
  today,
  onOpen,
}: EnergySectionProps) {
  const { bars, balance, scale } = summarizeEnergyBalance(energyBalance);
  const unit = energyLabel(energyUnit);
  const direction =
    balance === null
      ? null
      : balance > 0
        ? "deficit"
        : balance < 0
          ? "surplus"
          : "on target";

  const { daysTracked, daysOnTarget } = goalProgress;
  const adherence =
    hasPlan && daysTracked > 0 ? daysOnTarget / daysTracked : null;
  const caption = adherenceCaption(goalProgress, hasPlan);

  return (
    <Section title="Energy" action={{ label: "Progress", onPress: onOpen }}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={
          balance === null
            ? "Energy balance, last 7 days: not estimated yet"
            : `Energy balance, last 7 days: ${formatEnergy(Math.abs(balance), energyUnit)} ${unit} ${direction}`
        }
        style={({ pressed }) => [styles.block, pressed && styles.pressed]}
      >
        <View style={styles.blockText}>
          <Text variant="caption1" tone="secondary" eyebrow>
            Balance · 7 days
          </Text>
          <View style={styles.figureRow}>
            <Text variant="title2" figure>
              {balance === null
                ? "—"
                : formatEnergy(Math.abs(balance), energyUnit)}
            </Text>
            {direction ? (
              <Text variant="footnote" tone="secondary">
                {unit} {direction}
              </Text>
            ) : null}
          </View>
          <Text variant="footnote" tone="secondary">
            {balance === null
              ? "Expenditure appears once you’ve logged food and weigh-ins for a while."
              : "Intake against expenditure"}
          </Text>
        </View>
        <EnergyBars bars={bars} scale={scale} today={today} />
      </Pressable>

      <Hairline />

      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={
          adherence === null
            ? `On target: ${caption}`
            : `On target ${Math.round(adherence * 100)} percent: ${caption}`
        }
        style={({ pressed }) => [styles.goal, pressed && styles.pressed]}
      >
        <View style={styles.goalHeader}>
          <View style={styles.blockText}>
            <Text variant="caption1" tone="secondary" eyebrow>
              On target
            </Text>
            <Text variant="footnote" tone="secondary">
              {caption}
            </Text>
          </View>
          <Text variant="title2" figure>
            {adherence === null ? "—" : `${Math.round(adherence * 100)}%`}
          </Text>
        </View>
        <Meter progress={adherence ?? 0} color={macroColors.calories} />
      </Pressable>
    </Section>
  );
}

const styles = StyleSheet.create({
  block: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  blockText: {
    flex: 1,
    gap: spacing.xxs,
  },
  figureRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  chart: {
    width: "42%",
    gap: spacing.xs,
  },
  weekdays: {
    flexDirection: "row",
    gap: BAR_GAP,
  },
  weekday: {
    flex: 1,
  },
  goal: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  goalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  pressed: {
    opacity: 0.6,
  },
});
