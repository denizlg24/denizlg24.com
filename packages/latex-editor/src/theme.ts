import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const accent = (percent: number) =>
  `color-mix(in oklab, var(--accent) ${percent}%, transparent)`;
const muted = (percent: number) =>
  `color-mix(in oklab, var(--muted) ${percent}%, transparent)`;

/**
 * CodeMirror surface + syntax colors mapped onto the app's CSS theme tokens so
 * the editor tracks light/dark automatically. `dark` only feeds CodeMirror's
 * built-in defaults; all visible colors come from the cascading variables.
 */
export function appEditorTheme(dark: boolean): Extension[] {
  const surface = EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--card)",
        color: "var(--foreground)",
      },
      ".cm-content": { caretColor: "var(--foreground)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: accent(40) },
      ".cm-selectionMatch": { backgroundColor: accent(22) },
      ".cm-activeLine": { backgroundColor: muted(35) },
      ".cm-gutters": {
        backgroundColor: "var(--card)",
        color: "var(--muted-foreground)",
        border: "none",
      },
      ".cm-activeLineGutter": {
        backgroundColor: muted(35),
        color: "var(--foreground)",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "var(--muted)",
        color: "var(--muted-foreground)",
        border: "none",
      },
      "&.cm-focused .cm-matchingBracket, .cm-matchingBracket": {
        backgroundColor: accent(30),
        outline: `1px solid ${accent(55)}`,
      },
      ".cm-tooltip": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      },
    },
    { dark },
  );

  const highlight = HighlightStyle.define([
    {
      tag: t.comment,
      color: "color-mix(in oklab, var(--foreground) 55%, var(--card))",
      fontStyle: "italic",
      opacity: "0.76",
    },
    {
      tag: [
        t.keyword,
        t.controlKeyword,
        t.moduleKeyword,
        t.modifier,
        t.definitionKeyword,
      ],
      color: "var(--primary)",
      fontWeight: "600",
    },
    // \textbf, \textit, \emph, \underline map to strong/emphasis in the grammar.
    { tag: t.strong, color: "var(--primary)", fontWeight: "600" },
    { tag: t.emphasis, color: "var(--primary)", fontStyle: "italic" },
    { tag: t.monospace, color: "var(--accent-strong)" },
    {
      tag: [t.tagName, t.function(t.variableName), t.function(t.propertyName)],
      color: "var(--primary)",
    },
    {
      tag: [t.className, t.typeName, t.namespace, t.macroName],
      color: "var(--primary)",
    },
    {
      tag: [t.string, t.special(t.string), t.number, t.bool, t.atom],
      color: "var(--accent-strong)",
    },
    { tag: [t.labelName, t.quote], color: "var(--accent-strong)" },
    { tag: t.processingInstruction, color: "var(--primary)" },
    { tag: [t.variableName, t.propertyName], color: "var(--foreground)" },
    {
      tag: [t.brace, t.bracket, t.paren, t.punctuation, t.operator, t.meta],
      color: "var(--muted-foreground)",
    },
    {
      tag: [t.link, t.url],
      color: "var(--primary)",
      textDecoration: "underline",
    },
    { tag: t.heading, color: "var(--foreground)", fontWeight: "700" },
    { tag: t.invalid, color: "var(--destructive)" },
  ]);

  return [surface, syntaxHighlighting(highlight)];
}
