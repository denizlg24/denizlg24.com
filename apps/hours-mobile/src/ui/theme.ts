import {
  type ColorValue,
  PlatformColor,
  StyleSheet,
  type TextStyle,
  useColorScheme,
} from "react-native";

/**
 * Semantic iOS colours: they follow dark mode and Increase Contrast on their
 * own. Monochrome like the web app; status hues are the only colour.
 */
export const colors = {
  label: PlatformColor("label"),
  secondaryLabel: PlatformColor("secondaryLabel"),
  tertiaryLabel: PlatformColor("tertiaryLabel"),
  placeholder: PlatformColor("placeholderText"),
  background: PlatformColor("systemBackground"),
  secondaryBackground: PlatformColor("secondarySystemBackground"),
  groupedBackground: PlatformColor("systemGroupedBackground"),
  separator: PlatformColor("separator"),
  fill: PlatformColor("systemFill"),
  tertiaryFill: PlatformColor("tertiarySystemFill"),
  tint: PlatformColor("label"),
  onTint: PlatformColor("systemBackground"),
  destructive: PlatformColor("systemRed"),
  working: PlatformColor("systemGreen"),
  onBreak: PlatformColor("systemOrange"),
} satisfies Record<string, ColorValue>;

/** Concrete values for anything that cannot take a PlatformColor (Reanimated). */
export function useResolvedColors() {
  const dark = useColorScheme() === "dark";
  return {
    label: dark ? "#ffffff" : "#000000",
    background: dark ? "#000000" : "#ffffff",
    fill: dark ? "rgba(120,120,128,0.36)" : "rgba(120,120,128,0.2)",
  };
}

export const typeScale = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700" },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "600" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 22, fontWeight: "400" },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: "400" },
  subheadline: { fontSize: 15, lineHeight: 20, fontWeight: "400" },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  caption1: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: "400" },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof typeScale;

/** SF Pro Rounded with tabular digits, so running figures never jitter. */
export const figureStyle: TextStyle = {
  fontFamily: "ui-rounded",
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
