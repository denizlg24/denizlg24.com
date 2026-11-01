import { z } from "zod";

// ---------------------------------------------------------------------------
// Icons: a page, callout or module glyph. Either an emoji (pages written
// before icons) or `icon:<lucide-name>` with an optional `:<color>`.
// ---------------------------------------------------------------------------

export const ICON_COLORS = [
  "default",
  "muted",
  "accent",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;
export const iconColorSchema = z.enum(ICON_COLORS);
export type IconColor = z.infer<typeof iconColorSchema>;

const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ICON_VALUE_MAX = 64;
export const iconValueSchema = z
  .string()
  .min(1)
  .max(ICON_VALUE_MAX)
  .describe(
    "icon:<lucide-name>[:color] (e.g. icon:tree-pine:green), ri:<react-icons set>:<ComponentName>[:color] (e.g. ri:si:SiSpotify, ri:fa6:FaGift:red; sets: fa6, md, pi, tb, si, gi, bi, hi2, io5, ri, fi, bs, vsc, wi), or an emoji. Colors: default, muted, accent, gray, brown, orange, yellow, green, blue, purple, pink, red",
  );

/** react-icons sets an icon value may name; each loads on first use. */
export const REACT_ICON_SETS = [
  "fa6",
  "md",
  "pi",
  "tb",
  "si",
  "gi",
  "bi",
  "hi2",
  "io5",
  "ri",
  "fi",
  "bs",
  "vsc",
  "wi",
] as const;
export const reactIconSetSchema = z.enum(REACT_ICON_SETS);
export type ReactIconSet = z.infer<typeof reactIconSetSchema>;

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]{1,80}$/;

export type ParsedIcon =
  | { kind: "icon"; name: string; color: IconColor }
  | { kind: "react-icon"; set: ReactIconSet; name: string; color: IconColor }
  | { kind: "emoji"; value: string };

export function parseIconValue(value: string): ParsedIcon {
  if (value.startsWith("ri:")) {
    const [, set = "", name = "", color] = value.split(":");
    const parsedSet = reactIconSetSchema.safeParse(set);
    const parsedColor = iconColorSchema.safeParse(color ?? "default");
    if (parsedSet.success && COMPONENT_NAME.test(name)) {
      return {
        kind: "react-icon",
        set: parsedSet.data,
        name,
        color: parsedColor.success ? parsedColor.data : "default",
      };
    }
  }
  if (value.startsWith("icon:")) {
    const [, name = "", color] = value.split(":");
    const parsedColor = iconColorSchema.safeParse(color ?? "default");
    if (ICON_NAME.test(name)) {
      return {
        kind: "icon",
        name,
        color: parsedColor.success ? parsedColor.data : "default",
      };
    }
  }
  return { kind: "emoji", value };
}

export function iconValue(name: string, color: IconColor = "default"): string {
  return color === "default" ? `icon:${name}` : `icon:${name}:${color}`;
}

export function reactIconValue(
  set: ReactIconSet,
  name: string,
  color: IconColor = "default",
): string {
  return color === "default"
    ? `ri:${set}:${name}`
    : `ri:${set}:${name}:${color}`;
}

// ---------------------------------------------------------------------------
// Themes: CSS variables, fonts, an ambient effect, an optional background
// image and a bounded stylesheet. Built-ins live in code; the rest in Mongo.
// ---------------------------------------------------------------------------

/** Hex, or a colour function with no nested parentheses (so never `url(`). */
export const themeColorSchema = z
  .string()
  .max(64)
  .regex(
    /^(#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-zA-Z.,%\s/+-]*\)|transparent)$/,
    "A hex colour or rgb()/hsl()/oklch()",
  );

/** Required tokens every theme sets; the rest are derived from them when absent. */
export const THEME_CORE_TOKENS = [
  "background",
  "foreground",
  "surface",
  "muted",
  "mutedForeground",
  "accent",
  "accentStrong",
  "border",
] as const;

export const THEME_EXTRA_TOKENS = [
  "accentForeground",
  "primary",
  "primaryForeground",
  "card",
  "popover",
  "input",
  "ring",
  "destructive",
  "sidebar",
  "sidebarForeground",
  "sidebarAccent",
  "sidebarBorder",
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
  "chart6",
] as const;

export type ThemeToken =
  | (typeof THEME_CORE_TOKENS)[number]
  | (typeof THEME_EXTRA_TOKENS)[number];

export const themeColorsSchema = z.object({
  background: themeColorSchema,
  foreground: themeColorSchema,
  surface: themeColorSchema,
  muted: themeColorSchema,
  mutedForeground: themeColorSchema,
  accent: themeColorSchema,
  accentStrong: themeColorSchema.describe(
    "Headings, primary buttons, emphasis",
  ),
  border: themeColorSchema,
  accentForeground: themeColorSchema.optional(),
  primary: themeColorSchema.optional(),
  primaryForeground: themeColorSchema.optional(),
  card: themeColorSchema.optional(),
  popover: themeColorSchema.optional(),
  input: themeColorSchema.optional(),
  ring: themeColorSchema.optional(),
  destructive: themeColorSchema.optional(),
  sidebar: themeColorSchema.optional(),
  sidebarForeground: themeColorSchema.optional(),
  sidebarAccent: themeColorSchema.optional(),
  sidebarBorder: themeColorSchema.optional(),
  chart1: themeColorSchema.optional(),
  chart2: themeColorSchema.optional(),
  chart3: themeColorSchema.optional(),
  chart4: themeColorSchema.optional(),
  chart5: themeColorSchema.optional(),
  chart6: themeColorSchema.optional(),
});
export type ThemeColors = z.infer<typeof themeColorsSchema>;

export const THEME_FONTS = [
  "sans",
  "serif",
  "mono",
  "rounded",
  "display",
  "hand",
] as const;
export const themeFontSchema = z.enum(THEME_FONTS);
export type ThemeFont = z.infer<typeof themeFontSchema>;

export const THEME_EFFECTS = [
  "none",
  "snow",
  "leaves",
  "petals",
  "hearts",
  "stars",
  "confetti",
  "rain",
  "fireflies",
  "bubbles",
  "sparkles",
] as const;
export const themeEffectKindSchema = z.enum(THEME_EFFECTS);
export type ThemeEffectKind = z.infer<typeof themeEffectKindSchema>;

export const themeEffectSchema = z.object({
  kind: themeEffectKindSchema.default("none"),
  /** 0 is barely there, 1 a blizzard. */
  density: z.number().min(0).max(1).default(0.4),
  /** Particle tint; absent uses the effect's own palette. */
  color: themeColorSchema.optional(),
});
export type ThemeEffect = z.infer<typeof themeEffectSchema>;

/** Small glyphs a theme scatters: next to the page title and in the sidebar header. */
export const themeOrnamentSchema = z.object({
  /** Shown before every page title, e.g. icon:tree-pine:green. */
  title: iconValueSchema.optional(),
  /** Shown in the sidebar's header. */
  sidebar: iconValueSchema.optional(),
});
export type ThemeOrnament = z.infer<typeof themeOrnamentSchema>;

const FORBIDDEN_CSS =
  /url\s*\(|@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding|<\/?\s*style|<\s*script/i;

export const THEME_CSS_MAX = 12_000;

/**
 * Extra rules for the whole app. No `url()` or `@import`: a selector-dependent
 * fetch is how CSS leaks what a page shows, and an agent writes these.
 * Images go through `backgroundImage`, which is one fixed URL.
 */
export const themeCssSchema = z
  .string()
  .max(THEME_CSS_MAX)
  .refine((css) => !FORBIDDEN_CSS.test(css), {
    message: "No url(), @import, expression() or script in theme CSS",
  });

export const themeBackgroundSchema = z.object({
  /** https image laid behind the app. */
  url: z.url({ protocol: /^https$/ }).max(2048),
  /** How much of the image shows through the page colour, 0–1. */
  opacity: z.number().min(0).max(1).default(0.15),
  size: z.enum(["cover", "contain", "tile"]).default("cover"),
});
export type ThemeBackground = z.infer<typeof themeBackgroundSchema>;

const themeFields = {
  name: z.string().trim().min(1).max(60),
  description: z.string().max(300).default(""),
  /** Dark themes switch on every `dark:` variant as well. */
  scheme: z.enum(["light", "dark"]).default("light"),
  colors: themeColorsSchema,
  /** Corner radius in rem. */
  radius: z.number().min(0).max(1.5).default(0.625),
  fonts: z
    .object({
      body: themeFontSchema.default("sans"),
      heading: themeFontSchema.default("sans"),
    })
    .default({ body: "sans", heading: "sans" }),
  effect: themeEffectSchema.default({ kind: "none", density: 0.4 }),
  ornament: themeOrnamentSchema.default({}),
  background: themeBackgroundSchema.nullable().default(null),
  css: themeCssSchema.default(""),
};

export const themeInputSchema = z.object(themeFields);
export type ThemeInput = z.input<typeof themeInputSchema>;

export const themePatchSchema = z
  .object({
    name: themeFields.name,
    description: z.string().max(300),
    scheme: z.enum(["light", "dark"]),
    colors: themeColorsSchema.partial(),
    radius: themeFields.radius,
    fonts: z
      .object({ body: themeFontSchema, heading: themeFontSchema })
      .partial(),
    effect: themeEffectSchema.partial(),
    ornament: themeOrnamentSchema,
    background: themeBackgroundSchema.nullable(),
    css: themeCssSchema,
  })
  .partial();
export type ThemePatch = z.infer<typeof themePatchSchema>;

export const BUILTIN_THEME_PREFIX = "builtin:";

export const themeSchema = themeInputSchema.extend({
  id: z.string(),
  builtin: z.boolean(),
  /** A workspace actor: `owner`, `conversation:<id>`, `mcp:<client>`… */
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Theme = z.infer<typeof themeSchema>;

// ---------------------------------------------------------------------------
// Appearance: the singleton that says which theme is on and how the sidebar
// and pages are dressed. Separate from prefs, so an older client's PUT of
// favorites never clobbers it.
// ---------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isoDaySchema = z.string().regex(DAY, "YYYY-MM-DD");

/** `themeId` is on from `from` through `to`, inclusive, in the viewer's local days. */
export const themeScheduleEntrySchema = z
  .object({
    id: z.string().min(1).max(64),
    themeId: z.string().min(1).max(64),
    from: isoDaySchema,
    to: isoDaySchema,
    label: z.string().max(80).default(""),
  })
  .refine((entry) => entry.from <= entry.to, {
    message: "from must not be after to",
  });
export type ThemeScheduleEntry = z.infer<typeof themeScheduleEntrySchema>;

export const THEME_SCHEDULE_MAX = 40;

export const moduleCustomizationSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  icon: iconValueSchema.optional(),
});
export type ModuleCustomization = z.infer<typeof moduleCustomizationSchema>;

export const UI_DENSITIES = ["compact", "default", "comfortable"] as const;
export const uiDensitySchema = z.enum(UI_DENSITIES);
export type UiDensity = z.infer<typeof uiDensitySchema>;

export const appearanceInputSchema = z.object({
  /** The theme on when no schedule entry covers today. */
  themeId: z.string().min(1).max(64),
  schedule: z.array(themeScheduleEntrySchema).max(THEME_SCHEDULE_MAX),
  /** Root font size multiplier. */
  textScale: z.number().min(0.8).max(1.3),
  density: uiDensitySchema,
  /** Per module id: a label and icon replacing the built-in ones. */
  modules: z.record(z.string(), moduleCustomizationSchema),
  /** Module section ids in sidebar order; unnamed sections follow in their default order. */
  sectionOrder: z.array(z.string().max(40)).max(20),
  /** Module ids in order within their section; unnamed ones follow. */
  moduleOrder: z.array(z.string().max(60)).max(100),
});

export const appearanceSchema = appearanceInputSchema.extend({
  updatedAt: z.string().nullable(),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export const appearancePatchSchema = appearanceInputSchema.partial();
export type AppearancePatch = z.infer<typeof appearancePatchSchema>;

export const DEFAULT_THEME_ID = `${BUILTIN_THEME_PREFIX}sage`;

export const DEFAULT_APPEARANCE: Appearance = {
  themeId: DEFAULT_THEME_ID,
  schedule: [],
  textScale: 1,
  density: "default",
  modules: {},
  sectionOrder: [],
  moduleOrder: [],
  updatedAt: null,
};

export const appearanceResponseSchema = z.object({
  appearance: appearanceSchema,
  themes: z.array(themeSchema),
});
export type AppearanceResponse = z.infer<typeof appearanceResponseSchema>;

/** A schedule entry to add; the server mints its id. */
export const themeScheduleInputSchema = z
  .object({
    themeId: z.string().min(1).max(64),
    from: isoDaySchema,
    to: isoDaySchema,
    label: z.string().max(80).default(""),
  })
  .refine((entry) => entry.from <= entry.to, {
    message: "from must not be after to",
  });
export type ThemeScheduleInput = z.input<typeof themeScheduleInputSchema>;

/** The theme on for `day` (YYYY-MM-DD): the latest-starting schedule entry covering it, else `themeId`. */
export function activeThemeId(
  appearance: Pick<Appearance, "themeId" | "schedule">,
  day: string,
): string {
  let best: ThemeScheduleEntry | null = null;
  for (const entry of appearance.schedule) {
    if (entry.from <= day && day <= entry.to) {
      if (!best || entry.from > best.from) best = entry;
    }
  }
  return best?.themeId ?? appearance.themeId;
}

// ---------------------------------------------------------------------------
// Page style: how one page is dressed. Stored on the page, present only when
// something is set, so pages from before it compare equal.
// ---------------------------------------------------------------------------

export const PAGE_WIDTHS = ["narrow", "default", "wide", "full"] as const;
export const pageWidthSchema = z.enum(PAGE_WIDTHS);
export type PageWidth = z.infer<typeof pageWidthSchema>;

export const PAGE_COVER_GRADIENTS = [
  "dawn",
  "dusk",
  "forest",
  "ocean",
  "ember",
  "frost",
  "festive",
  "meadow",
  "plum",
  "sand",
] as const;

/** An https image, `gradient:<name>`, or `color:<css colour>`. */
export const pageCoverSchema = z.union([
  z.url({ protocol: /^https$/ }).max(2048),
  z
    .string()
    .regex(
      new RegExp(`^gradient:(${PAGE_COVER_GRADIENTS.join("|")})$`),
      "gradient:<name>",
    ),
  z
    .string()
    .regex(/^color:.+$/)
    .max(70),
]);

export const pageStyleSchema = z.object({
  cover: pageCoverSchema.optional(),
  /** Vertical position of an image cover, 0 (top) – 100 (bottom). */
  coverPosition: z.number().min(0).max(100).optional(),
  font: themeFontSchema.optional(),
  smallText: z.boolean().optional(),
  width: pageWidthSchema.optional(),
  /** Overrides the app theme while this page is open. */
  themeId: z.string().min(1).max(64).optional(),
  /** Hides the title block, for dashboards built from widgets. */
  hideTitle: z.boolean().optional(),
});
export type PageStyle = z.infer<typeof pageStyleSchema>;

/** Null when nothing is set, so an empty style is never stored. */
export function normalizePageStyle(
  style: PageStyle | null | undefined,
): PageStyle | null {
  if (!style) return null;
  const entries = Object.entries(style).filter(
    ([, value]) => value !== undefined && value !== false,
  );
  return entries.length ? (Object.fromEntries(entries) as PageStyle) : null;
}
