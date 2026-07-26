export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "cloud:theme";

export function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

/**
 * Runs before first paint, from a blocking inline <script> in the root layout.
 * Applying the class in an effect instead would render one frame in the wrong
 * theme on every load.
 *
 * `@repo/ui/theme.css` defines the dark variant as `&:is(.dark *)`, so the only
 * thing that has to be true is the `dark` class on <html>.
 */
export const themeScript = `(() => {
  try {
    var key = ${JSON.stringify(THEME_STORAGE_KEY)};
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var apply = function () {
      var stored = null;
      try { stored = window.localStorage.getItem(key); } catch (_) {}
      var dark = stored === "dark" || ((stored === "system" || stored === null) && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    media.addEventListener("change", apply);
    window.addEventListener("storage", function (event) {
      if (event.key === key) apply();
    });
  } catch (_) {}
})();`;
