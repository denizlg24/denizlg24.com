import Svg, { Circle, Polyline } from "react-native-svg";
import { useResolvedColors } from "@/ui";

/** A trend at a glance beside a figure: no axes, the latest point marked. */
export function Sparkline({
  values,
  width = 64,
  height = 24,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
}) {
  const resolved = useResolvedColors();
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.5);
  const pad = 3;
  const points = values.map((value, index) => ({
    x: pad + (index / (values.length - 1)) * (width - pad * 2),
    y: pad + (1 - (value - min) / range) * (height - pad * 2),
  }));
  const last = points[points.length - 1];

  return (
    <Svg width={width} height={height} accessible={false}>
      <Polyline
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
        fill="none"
        stroke={resolved.secondaryLabel}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {last ? (
        <Circle cx={last.x} cy={last.y} r={2.5} fill={resolved.label} />
      ) : null}
    </Svg>
  );
}
