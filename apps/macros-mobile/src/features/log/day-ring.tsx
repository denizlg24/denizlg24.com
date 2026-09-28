import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { macroColors, Text, useResolvedColors } from "@/ui";

export interface DayRingProps {
  day: number;
  /** Calories eaten over target; null when there is no target to measure against. */
  progress: number | null;
  selected?: boolean;
  today?: boolean;
  disabled?: boolean;
  size?: number;
}

/**
 * A day's number inside a ring that fills with the day's calories against
 * its target — the same reading as the web log's day pills.
 */
export function DayRing({
  day,
  progress,
  selected = false,
  today = false,
  disabled = false,
  size = 38,
}: DayRingProps) {
  const resolved = useResolvedColors();
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = progress ?? 0;
  const filled = Math.min(1, Math.max(0, ratio));
  const center = size / 2;

  return (
    <View style={{ width: size, height: size, opacity: disabled ? 0.3 : 1 }}>
      <Svg width={size} height={size}>
        {selected ? (
          <Circle
            cx={center}
            cy={center}
            r={radius - strokeWidth - 1}
            fill={resolved.label}
          />
        ) : null}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={resolved.fill}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {filled > 0 ? (
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={ratio > 1 ? macroColors.overflow : macroColors.calories}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - filled)}
            transform={`rotate(-90 ${center} ${center})`}
          />
        ) : null}
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text
          variant="footnote"
          figure
          weight={selected || today ? "bold" : "medium"}
          tone={selected ? "onTint" : "primary"}
          maxFontSizeMultiplier={1.2}
        >
          {day}
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
