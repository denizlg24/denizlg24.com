"use client";

import { useEffect, useLayoutEffect } from "react";
import { useAdmin } from "../../provider";
import { EffectLayer } from "./effect-layer";
import { useActiveTheme, useAppearanceStore } from "./store";
import { THEMED_VARIABLES, themeStylesheet, themeVariables } from "./theme-css";

const POLL_MS = 60_000;
const STYLE_ID = "workspace-theme";

/**
 * Puts the active theme on `<html>`: its variables, `.dark` for dark schemes,
 * a stylesheet for fonts, density, background and its own rules, and the
 * ambient effect. Re-reads appearance every minute and on focus, so a theme
 * an agent schedules shows up without a reload.
 */
export function ThemeRoot() {
  const { client } = useAdmin();
  const load = useAppearanceStore((s) => s.load);
  const textScale = useAppearanceStore((s) => s.appearance.textScale);
  const density = useAppearanceStore((s) => s.appearance.density);
  const theme = useActiveTheme();

  useEffect(() => {
    void load(client);
    const timer = setInterval(() => void load(client), POLL_MS);
    const onFocus = () => void load(client);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [client, load]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const vars = themeVariables(theme);
    for (const name of THEMED_VARIABLES) {
      if (name in vars) root.style.setProperty(name, vars[name]);
      else root.style.removeProperty(name);
    }
    root.classList.toggle("dark", theme.scheme === "dark");
    root.style.colorScheme = theme.scheme;
    root.dataset.theme = theme.id;

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = themeStylesheet(theme, { textScale, density });
  }, [theme, textScale, density]);

  useEffect(
    () => () => {
      const root = document.documentElement;
      for (const name of THEMED_VARIABLES) root.style.removeProperty(name);
      root.classList.remove("dark");
      root.style.removeProperty("color-scheme");
      delete root.dataset.theme;
      document.getElementById(STYLE_ID)?.remove();
    },
    [],
  );

  return <EffectLayer effect={theme.effect} />;
}
