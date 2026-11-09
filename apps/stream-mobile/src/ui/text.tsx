import { createContext, use } from "react";
import {
  Text as NativeText,
  type TextProps as NativeTextProps,
} from "react-native";
import { type ColorName, colors, type TypeVariant, typeScale } from "./theme";

/** 1 normally; `LARGER_TEXT_SCALE` for a profile that asked for larger text. */
export const TextScaleContext = createContext(1);

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
  const scale = use(TextScaleContext);
  const base = typeScale[variant];
  return (
    <NativeText
      {...props}
      style={[
        scale === 1
          ? base
          : {
              ...base,
              fontSize: (base.fontSize ?? 16) * scale,
              lineHeight: Math.round((base.lineHeight ?? 20) * scale),
            },
        { color: colors[color], fontVariant: ["tabular-nums"] },
        style,
      ]}
    />
  );
}
