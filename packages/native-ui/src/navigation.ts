import { fonts, useResolvedColors } from "./theme";

/** The theme's colours in React Navigation's shape, for `ThemeProvider`. */
export function useNavigationColors() {
  const color = useResolvedColors();
  return {
    primary: color.label,
    background: color.background,
    card: color.background,
    text: color.label,
    border: color.separator,
    notification: color.destructive,
  };
}

export const navigationFonts = {
  regular: { fontFamily: fonts.regular, fontWeight: "400" },
  medium: { fontFamily: fonts.medium, fontWeight: "500" },
  bold: { fontFamily: fonts.semibold, fontWeight: "600" },
  heavy: { fontFamily: fonts.bold, fontWeight: "700" },
} as const;

/** Every native stack: the site's faces in the header, the page colour behind it. */
export function useStackOptions() {
  const color = useResolvedColors();
  return {
    headerBackButtonDisplayMode: "minimal",
    headerShadowVisible: false,
    headerTintColor: color.label,
    headerTitleStyle: { fontFamily: fonts.semibold, color: color.label },
    headerLargeTitleStyle: { fontFamily: fonts.display, color: color.label },
    headerStyle: { backgroundColor: color.background },
    contentStyle: { backgroundColor: color.background },
  } as const;
}
