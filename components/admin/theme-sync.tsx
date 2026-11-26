"use client";

import { useEffect } from "react";

export function ThemeSync({
  theme,
}: {
  theme: "light" | "dark" | "system" | "terminal";
}) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return null;
}
