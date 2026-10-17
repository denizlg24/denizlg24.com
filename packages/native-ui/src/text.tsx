import {
  Text as NativeText,
  type TextProps as NativeTextProps,
} from "react-native";
import {
  colors,
  displayVariants,
  figureStyle,
  fonts,
  type TypeVariant,
  typeScale,
} from "./theme";

export type TextTone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "destructive"
  | "working"
  | "onBreak"
  | "onTint";

const toneColor = {
  primary: colors.label,
  secondary: colors.secondaryLabel,
  tertiary: colors.tertiaryLabel,
  destructive: colors.destructive,
  working: colors.working,
  onBreak: colors.onBreak,
  onTint: colors.onTint,
} as const;

export interface TextProps extends NativeTextProps {
  variant?: TypeVariant;
  tone?: TextTone;
  /** Rounded tabular digits for figures. */
  figure?: boolean;
  weight?: "regular" | "medium" | "semibold" | "bold";
  align?: "left" | "center" | "right";
  /** Editorial section label: uppercase with tracking. */
  eyebrow?: boolean;
}

export function Text({
  variant = "body",
  tone = "primary",
  figure = false,
  weight,
  align,
  eyebrow = false,
  style,
  ...rest
}: TextProps) {
  const face = displayVariants.has(variant)
    ? null
    : eyebrow
      ? fonts.semibold
      : weight
        ? fonts[weight]
        : null;
  return (
    <NativeText
      {...rest}
      style={[
        typeScale[variant],
        { color: toneColor[tone] },
        figure && figureStyle,
        face && { fontFamily: face },
        align && { textAlign: align },
        eyebrow && { textTransform: "uppercase", letterSpacing: 0.8 },
        style,
      ]}
    />
  );
}
