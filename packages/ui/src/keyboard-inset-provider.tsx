"use client";

import { useKeyboardInset } from "./hooks/use-keyboard-inset";

export function KeyboardInsetProvider() {
  useKeyboardInset();
  return null;
}
