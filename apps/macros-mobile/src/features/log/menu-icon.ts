import type { MenuAction } from "@expo/ui/community/menu";
import { type ImageSourcePropType, Platform } from "react-native";

/** SF Symbols on iOS; Android's Compose menu takes images instead. */
export function menuIcon(
  sfSymbol: Extract<MenuAction["image"], string>,
  glyph: ImageSourcePropType,
): MenuAction["image"] {
  return Platform.OS === "ios" ? sfSymbol : glyph;
}
