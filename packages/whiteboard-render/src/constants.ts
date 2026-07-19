import type { TextFontFamily } from "@repo/schemas";

export interface FontFamilyDefinition {
  label: string;
  /** CSS stack for the desktop editor. */
  css: string;
  /** Concrete family list for the exported/rasterized SVG. */
  svg: string;
  /** Approximate average glyph width as a fraction of fontSize. */
  widthFactor: number;
}

export const WHITEBOARD_FONT_FAMILIES: Record<
  TextFontFamily,
  FontFamilyDefinition
> = {
  handwriting: {
    label: "Excalifont",
    css: "'Excalifont', 'Comic Sans MS', cursive",
    svg: "Excalifont",
    widthFactor: 0.5,
  },
  sans: {
    label: "Sans",
    css: "ui-sans-serif, system-ui, sans-serif",
    svg: "Helvetica, Arial, Excalifont",
    widthFactor: 0.53,
  },
  serif: {
    label: "Serif",
    css: "ui-serif, Georgia, serif",
    svg: "Georgia, 'Times New Roman', Excalifont",
    widthFactor: 0.5,
  },
  mono: {
    label: "Mono",
    css: "ui-monospace, 'SF Mono', Menlo, monospace",
    svg: "Menlo, 'Courier New', Excalifont",
    widthFactor: 0.62,
  },
};

export const DEFAULT_FONT_FAMILY: TextFontFamily = "handwriting";
export const DEFAULT_FONT_WEIGHT = 400;
export const TEXT_LINE_HEIGHT = 1.3;
export const TEXT_PADDING = 2;

export const HIGHLIGHTER_OPACITY = 0.45;

export const DEFAULT_BOARD_BACKGROUND = "#ffffff";

export const WHITEBOARD_COLOR_PALETTE = [
  "#18181b",
  "#71717a",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0d9488",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#a16207",
  "#ffffff",
];

export const BOARD_BACKGROUND_PRESETS = [
  "#ffffff",
  "#faf9f6",
  "#f4f1e8",
  "#eef2ee",
  "#eceff4",
  "#1e1e20",
];

export interface StickyColor {
  name: string;
  bg: string;
  text: string;
  border: string;
  placeholder: string;
  dot: string;
}

export const STICKY_COLORS: StickyColor[] = [
  {
    name: "Sage",
    bg: "#e8edd9",
    text: "#3a4535",
    border: "#c8d4b0",
    placeholder: "#7a8a6e",
    dot: "#a1bc98",
  },
  {
    name: "Sand",
    bg: "#ece6da",
    text: "#4a3f30",
    border: "#d4c9b5",
    placeholder: "#8a7e6c",
    dot: "#c4b69c",
  },
  {
    name: "Clay",
    bg: "#ecddd5",
    text: "#4a3530",
    border: "#d4bfb3",
    placeholder: "#8a6e62",
    dot: "#c09a8a",
  },
  {
    name: "Fog",
    bg: "#e2e4e0",
    text: "#353835",
    border: "#c5c9c2",
    placeholder: "#6e756c",
    dot: "#9aa397",
  },
  {
    name: "Lavender",
    bg: "#e4dfe8",
    text: "#3a3540",
    border: "#c6bdd0",
    placeholder: "#7a7088",
    dot: "#a899b8",
  },
  {
    name: "Lichen",
    bg: "#dce6e2",
    text: "#2e3d38",
    border: "#b5cdc4",
    placeholder: "#627a72",
    dot: "#89b0a4",
  },
];

export const ARROW_HEAD_MAX_LENGTH = 16;
export const ARROW_HEAD_LENGTH_RATIO = 0.3;

export const COMPONENT_DEFAULT_SIZES: Record<
  string,
  { width: number; height: number }
> = {
  "todo-list": { width: 280, height: 320 },
  "sticky-note": { width: 240, height: 240 },
  "quick-links": { width: 280, height: 320 },
  "markdown-note": { width: 360, height: 400 },
  "pdf-viewer": { width: 500, height: 650 },
};
