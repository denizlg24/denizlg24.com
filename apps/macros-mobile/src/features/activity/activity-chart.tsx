import type { ActivityDay, ActivityMetric } from "@repo/macros-core/activity";
import { useWindowDimensions } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import { useResolvedColors } from "@/ui/theme";

export function ActivityChart({
  days,
  metric,
}: {
  days: readonly ActivityDay[];
  metric: ActivityMetric;
}) {
  const { width } = useWindowDimensions();
  const colors = useResolvedColors();
  const chartWidth = Math.max(1, width - 32);
  const height = 120;
  const max = Math.max(1, ...days.map((day) => day[metric] ?? 0));
  const slot = chartWidth / days.length;
  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${chartWidth} ${height}`}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Line
        x1={0}
        x2={chartWidth}
        y1={height - 1}
        y2={height - 1}
        stroke={colors.separator}
        strokeWidth={1}
      />
      {days.map((day, index) => {
        const value = day[metric];
        if (value === null) return null;
        const barHeight = Math.max(2, (value / max) * (height - 8));
        return (
          <Rect
            key={day.date}
            x={index * slot + slot * 0.15}
            y={height - barHeight - 1}
            width={slot * 0.7}
            height={barHeight}
            rx={1}
            fill={colors.label}
            opacity={index === days.length - 1 ? 1 : 0.55}
          />
        );
      })}
    </Svg>
  );
}
