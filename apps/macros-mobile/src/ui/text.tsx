import {
  Text as NativeText,
  type TextProps as NativeTextProps,
} from "react-native";
import { colors, figureStyle, type TypeVariant, typeScale } from "./theme";

export type TextTone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "tint"
  | "destructive"
  | "success"
  | "warning"
  | "onTint";

const toneColor = {
  primary: colors.label,
  secondary: colors.secondaryLabel,
  tertiary: colors.tertiaryLabel,
  tint: colors.tint,
  destructive: colors.destructive,
  success: colors.success,
  warning: colors.warning,
  onTint: colors.onTint,
} as const;

export interface TextProps extends NativeTextProps {
  variant?: TypeVariant;
  tone?: TextTone;
  /** Rounded tabular digits for numbers that change or line up in columns. */
  figure?: boolean;
  weight?: "regular" | "medium" | "semibold" | "bold";
  align?: "left" | "center" | "right";
  /** Editorial section label: small caps-like uppercase with tracking. */
  eyebrow?: boolean;
}

const weightValue = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

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
  return (
    <NativeText
      {...rest}
      style={[
        typeScale[variant],
        { color: toneColor[tone] },
        figure && figureStyle,
        weight && { fontWeight: weightValue[weight] },
        align && { textAlign: align },
        eyebrow && {
          textTransform: "uppercase",
          letterSpacing: 0.6,
          fontWeight: "600",
        },
        style,
      ]}
    />
  );
}
