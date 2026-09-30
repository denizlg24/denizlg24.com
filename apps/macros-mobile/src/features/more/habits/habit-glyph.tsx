import type { MacrosHabitIcon } from "@repo/schemas/macros";
import type { ColorValue } from "react-native";
import { colors, Icon } from "@/ui";

/** A habit's chosen icon, or a plain checklist for one without. */
export function HabitGlyph({
  icon,
  size = 20,
  color = colors.secondaryLabel,
}: {
  icon: MacrosHabitIcon | null;
  size?: number;
  color?: ColorValue;
}) {
  return <Icon name={icon ?? "list-checks"} size={size} color={color} />;
}
