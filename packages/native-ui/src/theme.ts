import {
  type ColorValue,
  DynamicColorIOS,
  StyleSheet,
  type TextStyle,
  useColorScheme,
} from "react-native";

/**
 * `packages/ui/src/theme.css` as native colours. Light and dark are the same
 * pairs the web app uses; status hues sit outside the green identity so they
 * stay readable at a glance.
 */
const palette = {
  label: { light: "#303630", dark: "#f1f3e0" },
  secondaryLabel: { light: "#647560", dark: "#d2dcb6" },
  tertiaryLabel: {
    light: "rgba(100,117,96,0.62)",
    dark: "rgba(210,220,182,0.55)",
  },
  placeholder: {
    light: "rgba(100,117,96,0.55)",
    dark: "rgba(210,220,182,0.45)",
  },
  background: { light: "#f9f8f6", dark: "#303630" },
  secondaryBackground: { light: "#f1f3e0", dark: "#3d463c" },
  groupedBackground: { light: "#f1f3e0", dark: "#282d28" },
  separator: { light: "#d2dcb6", dark: "#536150" },
  fill: { light: "rgba(161,188,152,0.38)", dark: "rgba(83,97,80,0.85)" },
  tertiaryFill: {
    light: "rgba(161,188,152,0.2)",
    dark: "rgba(83,97,80,0.5)",
  },
  accent: { light: "#a1bc98", dark: "#a1bc98" },
  tint: { light: "#303630", dark: "#a1bc98" },
  onTint: { light: "#f9f8f6", dark: "#303630" },
  destructive: { light: "#c0352b", dark: "#e05a5a" },
  working: { light: "#0c8a0c", dark: "#4fb84f" },
  onBreak: { light: "#b97d0a", dark: "#e0a020" },
  info: { light: "#4a7ab0", dark: "#7ea2c8" },
} as const;

type PaletteKey = keyof typeof palette;

export const colors = Object.fromEntries(
  Object.entries(palette).map(([key, pair]) => [key, DynamicColorIOS(pair)]),
) as Record<PaletteKey, ColorValue>;

/** Concrete values for anything that cannot take a dynamic colour (Reanimated, navigation themes). */
export function useResolvedColors(): Record<PaletteKey, string> {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return Object.fromEntries(
    Object.entries(palette).map(([key, pair]) => [key, pair[scheme]]),
  ) as Record<PaletteKey, string>;
}

/** PostScript names of the faces each app embeds through `@repo/native-ui/fonts`. */
export const fonts = {
  regular: "Inter-Regular",
  medium: "Inter-Medium",
  semibold: "Inter-SemiBold",
  bold: "Inter-Bold",
  display: "Calistoga-Regular",
} as const;

export type FontWeight = "regular" | "medium" | "semibold" | "bold";

/** Calistoga has one weight; the display sizes never take a weight override. */
export const displayVariants = new Set<TypeVariant>(["largeTitle", "title2"]);

export const typeScale = {
  largeTitle: { fontSize: 32, lineHeight: 40, fontFamily: fonts.display },
  title2: { fontSize: 24, lineHeight: 30, fontFamily: fonts.display },
  title3: { fontSize: 20, lineHeight: 25, fontFamily: fonts.semibold },
  headline: { fontSize: 17, lineHeight: 22, fontFamily: fonts.semibold },
  body: { fontSize: 16, lineHeight: 22, fontFamily: fonts.regular },
  callout: { fontSize: 15, lineHeight: 20, fontFamily: fonts.regular },
  subheadline: { fontSize: 14, lineHeight: 19, fontFamily: fonts.regular },
  footnote: { fontSize: 13, lineHeight: 18, fontFamily: fonts.regular },
  caption1: { fontSize: 12, lineHeight: 16, fontFamily: fonts.regular },
  caption2: { fontSize: 11, lineHeight: 13, fontFamily: fonts.regular },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof typeScale;

/** Tabular digits, so running figures never jitter. */
export const figureStyle: TextStyle = {
  fontVariant: ["tabular-nums"],
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const gutter = spacing.lg;
export const hairline = StyleSheet.hairlineWidth;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
