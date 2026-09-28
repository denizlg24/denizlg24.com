import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { macroColors, Text, useResolvedColors } from "@/ui";

export interface CalorieRingProps {
  consumed: number;
  target: number | null;
  /** What the centre figure shows; mirrors the profile's calorie preference. */
  mode?: "consumed" | "remaining";
  unitLabel?: string;
  formatValue?: (value: number) => string;
  size?: number;
  strokeWidth?: number;
}

export function CalorieRing({
  consumed,
  target,
  mode = "remaining",
  unitLabel = "kcal",
  formatValue = (value) => Math.round(value).toLocaleString(),
  size = 176,
  strokeWidth = 10,
}: CalorieRingProps) {
  const resolved = useResolvedColors();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = target && target > 0 ? consumed / target : 0;
  const over = progress > 1;
  const clamped = Math.min(1, Math.max(0, progress));
  const remaining = target !== null ? target - consumed : null;

  const figure =
    mode === "remaining" && remaining !== null
      ? formatValue(Math.abs(remaining))
      : formatValue(consumed);
  const caption =
    mode === "remaining" && remaining !== null
      ? remaining >= 0
        ? `${unitLabel} left`
        : `${unitLabel} over`
      : target !== null
        ? `of ${formatValue(target)} ${unitLabel}`
        : unitLabel;

  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${figure} ${caption}`}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={resolved.fill}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={over ? macroColors.overflow : macroColors.calories}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text variant="largeTitle" figure>
          {figure}
        </Text>
        <Text variant="footnote" tone={over ? "warning" : "secondary"}>
          {caption}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
});
