import type { LucideIcon } from "lucide-react-native";
import { Pressable, type PressableProps, StyleSheet } from "react-native";
import { colors } from "./theme";

export interface IconButtonProps
  extends Omit<PressableProps, "children" | "style"> {
  icon: LucideIcon;
  /** Read aloud; icon-only buttons always carry one. */
  label: string;
  size?: number;
  /** A translucent disc behind the glyph, for buttons over artwork. */
  scrim?: boolean;
  filled?: boolean;
  color?: string;
}

export function IconButton({
  icon: Icon,
  label,
  size = 22,
  scrim,
  filled,
  disabled,
  color = colors.paper,
  ...props
}: IconButtonProps) {
  const box = Math.max(44, size + 22);
  return (
    <Pressable
      {...props}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        { width: box, height: box, borderRadius: box / 2 },
        scrim ? styles.scrim : null,
        { opacity: disabled ? 0.32 : pressed ? 0.6 : 1 },
      ]}
    >
      <Icon color={color} size={size} fill={filled ? color : "none"} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  scrim: { backgroundColor: "rgba(12,11,10,0.55)" },
});
