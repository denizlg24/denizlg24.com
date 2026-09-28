import {
  MACRO_COLORS,
  NUTRIENT_OVERFLOW_COLOR,
} from "@repo/macros-core/macro-colors";
import {
  type ColorValue,
  PlatformColor,
  StyleSheet,
  type TextStyle,
  useColorScheme,
} from "react-native";

/**
 * Semantic iOS colours. They follow light/dark mode and Increase Contrast on
 * their own, so nothing in the app branches on the colour scheme for chrome.
 * The brand is monochrome like the web app: the tint is the label colour and
 * the macro hues are the only colour in the interface.
 */
export const colors = {
  label: PlatformColor("label"),
  secondaryLabel: PlatformColor("secondaryLabel"),
  tertiaryLabel: PlatformColor("tertiaryLabel"),
  quaternaryLabel: PlatformColor("quaternaryLabel"),
  placeholder: PlatformColor("placeholderText"),
  background: PlatformColor("systemBackground"),
  secondaryBackground: PlatformColor("secondarySystemBackground"),
  tertiaryBackground: PlatformColor("tertiarySystemBackground"),
  groupedBackground: PlatformColor("systemGroupedBackground"),
  secondaryGroupedBackground: PlatformColor("secondarySystemGroupedBackground"),
  separator: PlatformColor("separator"),
  opaqueSeparator: PlatformColor("opaqueSeparator"),
  fill: PlatformColor("systemFill"),
  secondaryFill: PlatformColor("secondarySystemFill"),
  tertiaryFill: PlatformColor("tertiarySystemFill"),
  quaternaryFill: PlatformColor("quaternarySystemFill"),
  tint: PlatformColor("label"),
  onTint: PlatformColor("systemBackground"),
  link: PlatformColor("link"),
  destructive: PlatformColor("systemRed"),
  success: PlatformColor("systemGreen"),
  warning: PlatformColor("systemOrange"),
} satisfies Record<string, ColorValue>;

export const macroColors = {
  calories: MACRO_COLORS.calories,
  protein: MACRO_COLORS.protein,
  carbs: MACRO_COLORS.carbs,
  fat: MACRO_COLORS.fat,
  fiber: MACRO_COLORS.fiber,
  overflow: NUTRIENT_OVERFLOW_COLOR,
} as const;

export type MacroColorKey = keyof typeof macroColors;

/**
 * Concrete hex values for surfaces that cannot resolve a PlatformColor —
 * react-native-svg paints and anything interpolated by Reanimated.
 */
export interface ResolvedColors {
  label: string;
  secondaryLabel: string;
  tertiaryLabel: string;
  separator: string;
  fill: string;
  background: string;
  groupedBackground: string;
  destructive: string;
}

const light: ResolvedColors = {
  label: "#000000",
  secondaryLabel: "rgba(60,60,67,0.6)",
  tertiaryLabel: "rgba(60,60,67,0.3)",
  separator: "rgba(60,60,67,0.29)",
  fill: "rgba(120,120,128,0.2)",
  background: "#ffffff",
  groupedBackground: "#f2f2f7",
  destructive: "#ff3b30",
};

const dark: ResolvedColors = {
  label: "#ffffff",
  secondaryLabel: "rgba(235,235,245,0.6)",
  tertiaryLabel: "rgba(235,235,245,0.3)",
  separator: "rgba(84,84,88,0.65)",
  fill: "rgba(120,120,128,0.36)",
  background: "#000000",
  groupedBackground: "#000000",
  destructive: "#ff453a",
};

export function useResolvedColors(): ResolvedColors {
  return useColorScheme() === "dark" ? dark : light;
}

/** iOS text styles (points at the default Dynamic Type size). */
export const typeScale = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700" },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
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

/** Figures use SF Pro Rounded with tabular digits so columns line up. */
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

/** Standard iOS content margin. */
export const gutter = spacing.lg;

export const hairline = StyleSheet.hairlineWidth;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;
