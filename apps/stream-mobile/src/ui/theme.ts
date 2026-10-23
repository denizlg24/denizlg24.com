import type { Genre, ProfileColor } from "@repo/schemas/stream";
import { Platform, StyleSheet, type TextStyle } from "react-native";

/**
 * Ink-dark only (plan 031, "Visual system"): imagery carries the colour,
 * hairlines and whitespace do the structure. Plain hex, never
 * `PlatformColor`, so Android draws the same thing.
 */
export const colors = {
  ink: "#0c0b0a",
  raised: "#151412",
  lifted: "#1f1d1a",
  paper: "#efe9df",
  muted: "#8e877c",
  faint: "rgba(239,233,223,0.42)",
  hairline: "rgba(239,233,223,0.10)",
  fill: "rgba(239,233,223,0.08)",
  amber: "#f2b54a",
  amberGlow: "rgba(242,181,74,0.35)",
  onAmber: "#0c0b0a",
  danger: "#ef7d6d",
} as const;

export type ColorName = keyof typeof colors;

export const profileColors: Record<ProfileColor, string> = {
  ember: "#e8743b",
  tide: "#3d9bd1",
  moss: "#7fa65a",
  dusk: "#9a7fd1",
  sand: "#d9b77e",
  rose: "#e07a9a",
};

export const profileColorNames: Record<ProfileColor, string> = {
  ember: "Ember",
  tide: "Tide",
  moss: "Moss",
  dusk: "Dusk",
  sand: "Sand",
  rose: "Rose",
};

/** Map tints: each genre's dots take the hue of its nearest anchor. */
export const genreTints: Record<Genre, string> = {
  Action: "#e8743b",
  Adventure: "#d9a04a",
  Animation: "#7fd1c4",
  Biography: "#b8a58a",
  Comedy: "#f2d14a",
  Crime: "#a35a4a",
  Documentary: "#9aa88a",
  Drama: "#c98a6a",
  Family: "#8fd18a",
  Fantasy: "#b48ae0",
  History: "#a8946a",
  Horror: "#c24a4a",
  Music: "#e07ac4",
  Musical: "#e09aa8",
  Mystery: "#6a7fb8",
  Romance: "#e07a9a",
  "Sci-Fi": "#5ab8e0",
  Sport: "#7fa65a",
  Thriller: "#8a6ab8",
  War: "#8e877c",
  Western: "#c9a46a",
};

/**
 * Big Shoulders (800/900) for display, Atkinson Hyperlegible Next (400/700)
 * for everything else, embedded on both platforms. iOS finds a face by its
 * PostScript name, Android by its file name. Weight always comes from the
 * family, never `fontWeight`, which Android would answer with a synthetic or
 * system face.
 */
export const fonts = {
  display: Platform.select({
    android: "BigShoulders_900Black",
    default: "BigShoulders-Black",
  }),
  displayBold: Platform.select({
    android: "BigShoulders_800ExtraBold",
    default: "BigShoulders-ExtraBold",
  }),
  regular: Platform.select({
    android: "AtkinsonHyperlegibleNext_400Regular",
    default: "AtkinsonHyperlegibleNext-Regular",
  }),
  bold: Platform.select({
    android: "AtkinsonHyperlegibleNext_700Bold",
    default: "AtkinsonHyperlegibleNext-Bold",
  }),
} as const;

/** Display sizes sit tight: line height about 0.92 of the size. */
const display = (size: number, family: string = fonts.display): TextStyle => ({
  fontSize: size,
  lineHeight: Math.round(size * 0.92),
  fontFamily: family,
});

const text = (
  size: number,
  lineHeight: number,
  family: string = fonts.regular,
): TextStyle => ({
  fontSize: size,
  lineHeight,
  fontFamily: family,
});

export const typeScale = {
  /** The Tonight lead and the title page. */
  marquee: display(60),
  hero: display(44),
  /** Section headings. */
  display: display(34, fonts.displayBold),
  title: display(26, fonts.displayBold),
  /** Small display: titles set on stills, dial readings. */
  heading: display(21, fonts.displayBold),
  headline: text(17, 22, fonts.bold),
  /** A reason, an overview: 19 pt, comfortably spaced. */
  lede: text(19, 27),
  body: text(16, 23),
  callout: text(15, 20, fonts.bold),
  subheadline: text(14, 19),
  footnote: text(13, 18),
  caption: text(12, 16),
  /** Sentence-case bold labels: dial names, filters. */
  label: text(14, 18, fonts.bold),
  /** Classic: about 20 pt body, for whoever wants it big. */
  classicTitle: display(40),
  classicHeading: text(24, 30, fonts.bold),
  classicBody: text(20, 28),
  classicLabel: text(20, 24, fonts.bold),
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof typeScale;

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

export const gutter = spacing.xl;
export const hairline = StyleSheet.hairlineWidth;
export const radius = { poster: 4, sm: 6, md: 10, lg: 14, pill: 999 } as const;

/** Poster artwork is 2:3, backdrops 16:9. */
export const POSTER_RATIO = 2 / 3;
export const BACKDROP_RATIO = 16 / 9;
