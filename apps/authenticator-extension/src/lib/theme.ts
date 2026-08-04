/**
 * Drives the `.dark` class that @repo/ui's tokens key off.
 *
 * The choice is a stored preference shared by the popup and the options page, so
 * changing it in one takes effect in the other through `storage.onChanged`
 * without either having to reload.
 */

import { browser } from "./browser";
import { readPreferences } from "./storage";
import type { ThemePreference } from "./types";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(preference: ThemePreference): void {
  const dark =
    preference === "system" ? systemPrefersDark() : preference === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Paints the system scheme synchronously so the first frame is never the wrong
 * colour, then corrects once the stored preference has been read.
 */
export function startThemeSync(): () => void {
  let preference: ThemePreference = "system";
  applyTheme(preference);

  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (preference === "system") applyTheme(preference);
  };
  query.addEventListener("change", onSystemChange);

  const load = async () => {
    preference = (await readPreferences()).theme;
    applyTheme(preference);
  };
  void load();

  const onStorageChange = () => {
    void load();
  };
  browser.storage.onChanged.addListener(onStorageChange);

  return () => {
    query.removeEventListener("change", onSystemChange);
    browser.storage.onChanged.removeListener(onStorageChange);
  };
}
