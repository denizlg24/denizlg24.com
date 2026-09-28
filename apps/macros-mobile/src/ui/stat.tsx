import { StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./text";
import { colors, hairline, spacing, type TypeVariant } from "./theme";

export interface StatProps {
  label: string;
  value: string;
  unit?: string;
  /** Secondary line under the figure, e.g. "of 2,300". */
  detail?: string;
  size?: "hero" | "large" | "regular";
  align?: "left" | "center" | "right";
  style?: ViewStyle;
}

const valueVariant: Record<NonNullable<StatProps["size"]>, TypeVariant> = {
  hero: "largeTitle",
  large: "title2",
  regular: "title3",
};

/** A bare figure with a small label — no tile, no border. */
export function Stat({
  label,
  value,
  unit,
  detail,
  size = "regular",
  align = "left",
  style,
}: StatProps) {
  const alignItems =
    align === "center"
      ? "center"
      : align === "right"
        ? "flex-end"
        : "flex-start";
  return (
    <View style={[{ alignItems, gap: spacing.xxs }, style]}>
      <Text variant="caption1" tone="secondary" eyebrow>
        {label}
      </Text>
      <View style={styles.valueRow}>
        <Text variant={valueVariant[size]} figure>
          {value}
        </Text>
        {unit ? (
          <Text variant="footnote" tone="secondary">
            {unit}
          </Text>
        ) : null}
      </View>
      {detail ? (
        <Text variant="footnote" tone="secondary" figure>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

export interface MeterProps {
  /** 0..1; values above 1 are drawn full in the overflow colour. */
  progress: number;
  color: string;
  overflowColor?: string;
  height?: number;
  style?: ViewStyle;
}

/** A thin meter instead of a chunky progress bar. */
export function Meter({
  progress,
  color,
  overflowColor,
  height = 3,
  style,
}: MeterProps) {
  const clamped = Math.max(
    0,
    Math.min(1, Number.isFinite(progress) ? progress : 0),
  );
  const over = progress > 1;
  return (
    <View
      style={[
        styles.track,
        { height, borderRadius: height / 2, backgroundColor: colors.fill },
        style,
      ]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: over && overflowColor ? overflowColor : color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
  },
  track: {
    overflow: "hidden",
    minHeight: hairline,
  },
});
