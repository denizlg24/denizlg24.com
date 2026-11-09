import { Text, type TextProps, type TextStyle } from "react-native";
import { type ColorName, colors, fonts } from "@/ui";

const display = (size: number, family: string = fonts.display): TextStyle => ({
  fontSize: size,
  lineHeight: Math.round(size * 0.92),
  fontFamily: family,
});

const text = (size: number, lineHeight: number, bold = false): TextStyle => ({
  fontSize: size,
  lineHeight,
  fontFamily: bold ? fonts.bold : fonts.regular,
});

/**
 * The TV's own scale, sized for a 960 × 540 dp screen read from the sofa.
 * Weight comes from the family; numerals are tabular.
 */
export const tvType = {
  /** A title with no logo on the billboard or the title page. */
  marquee: display(52),
  /** Page headings: My List, an actor, a collection. */
  heading: display(34, fonts.displayBold),
  /** A title set on box art when TMDB has no logo for it. */
  art: display(20, fonts.displayBold),
  numeral: display(150),
  rowLabel: text(17, 22, true),
  lede: text(17, 25),
  body: text(15, 21),
  bodyStrong: text(15, 21, true),
  meta: text(14, 19),
  metaStrong: text(14, 19, true),
  caption: text(12, 16),
  nav: text(18, 24),
  navStrong: text(18, 24, true),
  key: text(18, 22, true),
} satisfies Record<string, TextStyle>;

export type TvTextVariant = keyof typeof tvType;

export interface TvTextProps extends TextProps {
  variant?: TvTextVariant;
  color?: ColorName;
}

export function TvText({
  variant = "body",
  color = "paper",
  style,
  ...props
}: TvTextProps) {
  return (
    <Text
      {...props}
      style={[
        tvType[variant],
        { color: colors[color], fontVariant: ["tabular-nums"] },
        style,
      ]}
    />
  );
}
