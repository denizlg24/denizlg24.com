import type { Theme, ThemeColors, ThemeFont, UiDensity } from "@repo/schemas";

export const FONT_STACKS: Record<ThemeFont, string> = {
  sans: "var(--font-inter, ui-sans-serif), ui-sans-serif, system-ui, sans-serif",
  serif: '"Iowan Old Style", "Charter", "Palatino Linotype", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif',
  display: 'var(--font-calistoga, Georgia), "Cooper Black", Georgia, serif',
  hand: '"Excalifont", "Segoe Print", "Comic Sans MS", cursive',
};

const SPACING: Record<UiDensity, string> = {
  compact: "0.22rem",
  default: "0.25rem",
  comfortable: "0.28rem",
};

/** CSS custom properties a theme sets on `<html>`; tokens it leaves out derive from the core ones. */
export function themeVariables(theme: Theme): Record<string, string> {
  const c: ThemeColors = theme.colors;
  const accentForeground = c.accentForeground ?? c.foreground;
  const primary = c.primary ?? c.accentStrong;
  const primaryForeground = c.primaryForeground ?? c.background;
  const vars: Record<string, string> = {
    "--background": c.background,
    "--foreground": c.foreground,
    "--surface": c.surface,
    "--muted": c.muted,
    "--muted-foreground": c.mutedForeground,
    "--accent": c.accent,
    "--accent-strong": c.accentStrong,
    "--accent-foreground": accentForeground,
    "--border": c.border,
    "--card": c.card ?? c.background,
    "--card-foreground": c.foreground,
    "--popover": c.popover ?? c.background,
    "--popover-foreground": c.foreground,
    "--primary": primary,
    "--primary-foreground": primaryForeground,
    "--secondary": c.surface,
    "--secondary-foreground": c.foreground,
    "--input": c.input ?? c.surface,
    "--ring": c.ring ?? c.accentStrong,
    "--sidebar": c.sidebar ?? c.background,
    "--sidebar-foreground": c.sidebarForeground ?? c.foreground,
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": primaryForeground,
    "--sidebar-accent": c.sidebarAccent ?? c.surface,
    "--sidebar-accent-foreground": c.sidebarForeground ?? c.foreground,
    "--sidebar-border": c.sidebarBorder ?? c.border,
    "--sidebar-ring": c.ring ?? c.accentStrong,
    "--radius": `${theme.radius}rem`,
  };
  if (c.destructive) vars["--destructive"] = c.destructive;
  const charts = [c.chart1, c.chart2, c.chart3, c.chart4, c.chart5, c.chart6];
  charts.forEach((value, index) => {
    if (value) vars[`--chart-${index + 1}`] = value;
  });
  return vars;
}

export const THEMED_VARIABLES = [
  "--background",
  "--foreground",
  "--surface",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-strong",
  "--accent-foreground",
  "--border",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--input",
  "--ring",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
  "--radius",
  "--destructive",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--spacing",
] as const;

/** The stylesheet a theme adds: fonts, density, its background image, its own rules. */
export function themeStylesheet(
  theme: Theme,
  options: { textScale: number; density: UiDensity },
): string {
  const rules: string[] = [
    `html { font-size: ${(16 * options.textScale).toFixed(2)}px; --spacing: ${SPACING[options.density]}; }`,
    // On body, not html: the stacks name next/font variables that only body defines,
    // and a custom property resolves var() where it is declared.
    `body { --theme-font-body: ${FONT_STACKS[theme.fonts.body]}; --theme-font-heading: ${FONT_STACKS[theme.fonts.heading]}; }`,
    "body, .font-inter { font-family: var(--theme-font-body); }",
    "h1, h2, h3, .theme-heading { font-family: var(--theme-font-heading); }",
  ];
  if (theme.background) {
    const size =
      theme.background.size === "tile" ? "auto" : theme.background.size;
    const repeat = theme.background.size === "tile" ? "repeat" : "no-repeat";
    rules.push(
      `body::after { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 1; background-image: url(${JSON.stringify(theme.background.url)}); background-size: ${size}; background-repeat: ${repeat}; background-position: center; opacity: ${theme.background.opacity}; }`,
    );
  }
  if (theme.css) rules.push(theme.css);
  return rules.join("\n");
}
