import type { LucideIcon } from "lucide-react-native";
import { useState } from "react";
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
  onFocus,
  onBlur,
  ...props
}: IconButtonProps) {
  const box = Math.max(44, size + 22);
  // Only a TV remote focuses it: the disc turns paper, like `Button`.
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...props}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={8}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={({ pressed }) => [
        styles.base,
        { width: box, height: box, borderRadius: box / 2 },
        scrim ? styles.scrim : null,
        focused ? styles.focused : null,
        { opacity: disabled ? 0.32 : pressed ? 0.6 : 1 },
      ]}
    >
      <Icon
        color={focused ? colors.ink : color}
        size={size}
        fill={filled ? (focused ? colors.ink : color) : "none"}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  scrim: { backgroundColor: "rgba(12,11,10,0.55)" },
  focused: { backgroundColor: colors.paper },
});
