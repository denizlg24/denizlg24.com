import type { ThemeRegistrationResolved } from "shiki";

type CodePalette = {
  foreground: string;
  comment: string;
  keyword: string;
  entity: string;
  constant: string;
  string: string;
  builtin: string;
  tag: string;
  inserted: string;
  deleted: string;
};

const TRANSPARENT = "#00000000";

export type CodeTheme = Pick<
  ThemeRegistrationResolved,
  "name" | "type" | "fg" | "bg" | "colors" | "settings"
>;

const buildTheme = (
  name: string,
  type: "light" | "dark",
  palette: CodePalette,
): CodeTheme => ({
  name,
  type,
  fg: palette.foreground,
  bg: TRANSPARENT,
  colors: {
    "editor.background": TRANSPARENT,
    "editor.foreground": palette.foreground,
  },
  settings: [
    { settings: { foreground: palette.foreground, background: TRANSPARENT } },
    {
      scope: ["comment", "punctuation.definition.comment", "string.comment"],
      settings: { foreground: palette.comment, fontStyle: "italic" },
    },
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.operator.new",
        "keyword.operator.expression",
        "keyword.operator.logical",
        "variable.language",
      ],
      settings: { foreground: palette.keyword },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call entity.name.function",
        "entity.name.class",
        "entity.name.type",
        "entity.other.inherited-class",
        "support.class",
      ],
      settings: { foreground: palette.entity },
    },
    {
      scope: [
        "constant",
        "constant.numeric",
        "constant.language",
        "constant.character",
        "variable.other.constant",
        "entity.other.attribute-name",
        "support.constant",
        "support.type.property-name",
        "meta.object-literal.key",
      ],
      settings: { foreground: palette.constant },
    },
    {
      scope: [
        "string",
        "string.regexp",
        "punctuation.definition.string",
        "markup.inline.raw",
      ],
      settings: { foreground: palette.string },
    },
    {
      scope: [
        "support.type",
        "support.type.primitive",
        "support.variable",
        "entity.name.namespace",
        "entity.name.tag.yaml",
      ],
      settings: { foreground: palette.builtin },
    },
    {
      scope: ["entity.name.tag", "meta.tag.sgml", "markup.heading"],
      settings: { foreground: palette.tag },
    },
    { scope: "markup.bold", settings: { fontStyle: "bold" } },
    { scope: "markup.italic", settings: { fontStyle: "italic" } },
    { scope: "markup.inserted", settings: { foreground: palette.inserted } },
    { scope: "markup.deleted", settings: { foreground: palette.deleted } },
    {
      scope: ["markup.underline.link", "string.other.link"],
      settings: { foreground: palette.string },
    },
  ],
});

/** Built from the sage palette in theme.css; backgrounds are transparent so the container's surface shows through. */
export const codeThemeLight = buildTheme("denizlg24-light", "light", {
  foreground: "#303630",
  comment: "#647560",
  keyword: "#9a5a26",
  entity: "#6e5a8a",
  constant: "#4b6b3f",
  string: "#336d73",
  builtin: "#8a6a2f",
  tag: "#557a3e",
  inserted: "#4b6b3f",
  deleted: "#a0442f",
});

export const codeThemeDark = buildTheme("denizlg24-dark", "dark", {
  foreground: "#d2dcb6",
  comment: "#a3b09c",
  keyword: "#d4a373",
  entity: "#c9b8d4",
  constant: "#a1bc98",
  string: "#9cc5c9",
  builtin: "#d4b896",
  tag: "#b8d4a3",
  inserted: "#b8d4a3",
  deleted: "#d4a373",
});

export const codeThemes: [CodeTheme, CodeTheme] = [
  codeThemeLight,
  codeThemeDark,
];
