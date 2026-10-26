import { type RefObject, useState } from "react";
import type { TextInput } from "react-native";
import { useRemote } from "./remote";

/**
 * Android's text field keeps Up for its cursor, so a remote could never
 * leave it for the nav. While the field has focus, Up blurs it and asks the
 * nav to take focus (`TvNavBar preferred`, which acts when it turns true).
 */
export function useFieldEscape(
  input: RefObject<TextInput | null>,
  fieldFocused: boolean,
  initial = false,
): { navPreferred: boolean; onFieldFocus: () => void } {
  const [navPreferred, setNavPreferred] = useState(initial);
  useRemote((key) => {
    if (key !== "up") return;
    input.current?.blur();
    setNavPreferred(true);
  }, fieldFocused);
  return { navPreferred, onFieldFocus: () => setNavPreferred(false) };
}
