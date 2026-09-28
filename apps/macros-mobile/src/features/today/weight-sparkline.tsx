import { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useResolvedColors } from "@/ui";
import type { WeightSparkPoint } from "./logic";

const PADDING = 4;

/**
 * The smoothed trend as a line with the raw scale readings as faint dots —
 * the same reading of weight the Progress tab gives, at thumbnail size.
 */
export function WeightSparkline({
  points,
  height = 56,
}: {
  points: WeightSparkPoint[];
  height?: number;
}) {
  const resolved = useResolvedColors();
  const [width, setWidth] = useState(0);

  const values = points.flatMap((point) =>
    point.scaleKg !== null ? [point.trendKg, point.scaleKg] : [point.trendKg],
  );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const middle = (min + max) / 2;
  const range = Math.max(max - min, 0.5);
  const low = middle - range / 2;

  const x = (index: number) =>
    PADDING +
    (points.length > 1 ? index / (points.length - 1) : 0.5) *
      (width - PADDING * 2);
  const y = (kg: number) =>
    height - PADDING - ((kg - low) / range) * (height - PADDING * 2);

  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(point.trendKg).toFixed(1)}`,
    )
    .join(" ");
  const last = points.at(-1);

  return (
    <View
      style={{ height }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityElementsHidden
    >
      {width > 0 && points.length > 1 ? (
        <Svg width={width} height={height}>
          {points.map((point, index) =>
            point.scaleKg !== null ? (
              <Circle
                key={point.date}
                cx={x(index)}
                cy={y(point.scaleKg)}
                r={1.75}
                fill={resolved.tertiaryLabel}
              />
            ) : null,
          )}
          <Path
            d={path}
            stroke={resolved.label}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {last ? (
            <Circle
              cx={x(points.length - 1)}
              cy={y(last.trendKg)}
              r={3}
              fill={resolved.label}
            />
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}
