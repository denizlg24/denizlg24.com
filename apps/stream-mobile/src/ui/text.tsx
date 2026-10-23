import {
  Text as NativeText,
  type TextProps as NativeTextProps,
} from "react-native";
import { type ColorName, colors, type TypeVariant, typeScale } from "./theme";

export interface TextProps extends NativeTextProps {
  variant?: TypeVariant;
  color?: ColorName;
}

/** Numerals are always tabular, so running figures never jitter. */
export function Text({
  variant = "body",
  color = "paper",
  style,
  ...props
}: TextProps) {
  return (
    <NativeText
      {...props}
      style={[
        typeScale[variant],
        { color: colors[color], fontVariant: ["tabular-nums"] },
        style,
      ]}
    />
  );
}
