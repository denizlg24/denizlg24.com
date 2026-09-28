import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import { type IconName, icons } from "./icons";
import { colors } from "./theme";

export type { IconName };

export type IconWeight = "light" | "regular" | "medium" | "semibold" | "bold";

// Lucide draws a 24-unit grid with 2-unit strokes; the weights keep that
// look at small sizes rather than thinning out.
const strokeWidths: Record<IconWeight, number> = {
  light: 1.5,
  regular: 2,
  medium: 2.25,
  semibold: 2.5,
  bold: 2.75,
};

export interface IconProps {
  name: IconName;
  size?: number;
  color?: ColorValue;
  weight?: IconWeight;
  /** Fills the outline with the stroke colour, for "on" states. */
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Icon({
  name,
  size = 20,
  color = colors.label,
  weight = "regular",
  filled = false,
  style,
  accessibilityLabel,
}: IconProps) {
  const Glyph = icons[name];
  return (
    <Glyph
      size={size}
      color={color}
      fill={filled ? color : "none"}
      strokeWidth={strokeWidths[weight]}
      style={style}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
