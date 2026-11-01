import { z } from "zod";
import { iconColorSchema, iconValueSchema } from "./workspace-appearance";
import { entityRefSchema, RECORD_REFS_MAX } from "./workspace-entities";
import { viewConfigSchema } from "./workspace-views";

/**
 * Custom UI elements: components the owner or an agent builds, kept in a
 * library and placed on pages with a `component` block.
 *
 * - `spec`: a JSON tree of the app's own primitives, rendered natively and
 *   themed with the app. The visual editor writes this shape.
 * - `html`: HTML, CSS and JS run in a sandboxed iframe with no same-origin
 *   access and no network (a CSP refuses fetch and remote images, since the
 *   script holds the owner's data); the theme's colours arrive as CSS
 *   variables and the data as `window.component.data` (plus a
 *   `component:data` event on change).
 *
 * Text in a spec interpolates `{{path}}` against the data scope: each bound
 * source by name, `props` (the block's values), `item` / `index` inside a
 * `repeat`, and `today`.
 */

// ---------------------------------------------------------------------------
// Data bindings
// ---------------------------------------------------------------------------

const bindingName = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/)
  .describe("Name the data is reachable under, e.g. tasks → {{tasks.rows}}");

export const componentBindingSchema = z.discriminatedUnion("kind", [
  z.object({
    name: bindingName,
    kind: z.literal("view"),
    /** Rows of a module query: `{ rows, total, totals, groups }`. */
    view: viewConfigSchema,
  }),
  z.object({
    name: bindingName,
    kind: z.literal("records"),
    /** Record summaries: `[{ title, subtitle, fields, ref }]`. */
    refs: z.array(entityRefSchema).max(RECORD_REFS_MAX),
  }),
  z.object({
    name: bindingName,
    kind: z.literal("json"),
    /** Constant data written into the component. */
    value: z.unknown(),
  }),
]);
export type ComponentBinding = z.infer<typeof componentBindingSchema>;
export type ComponentBindingInput = z.input<typeof componentBindingSchema>;

export const COMPONENT_BINDINGS_MAX = 8;

/** A value the placing block may set, reachable as `{{props.<name>}}`. */
export const componentPropSchema = z.object({
  name: bindingName,
  label: z.string().max(60).default(""),
  type: z.enum(["text", "number", "boolean", "color", "date"]),
  default: z.union([z.string().max(2000), z.number(), z.boolean()]).optional(),
});
export type ComponentProp = z.infer<typeof componentPropSchema>;

// ---------------------------------------------------------------------------
// Spec: the native tree
// ---------------------------------------------------------------------------

export const UI_NODE_TYPES = [
  "stack",
  "row",
  "grid",
  "card",
  "text",
  "heading",
  "stat",
  "badge",
  "icon",
  "image",
  "progress",
  "divider",
  "spacer",
  "link",
  "button",
  "list",
  "chart",
  "countdown",
  "clock",
  "markdown",
] as const;
export const uiNodeTypeSchema = z.enum(UI_NODE_TYPES);
export type UiNodeType = z.infer<typeof uiNodeTypeSchema>;

export const UI_TONES = [
  "default",
  "muted",
  "accent",
  "good",
  "warning",
  "critical",
  "info",
] as const;
export const uiToneSchema = z.enum(UI_TONES);
export type UiTone = z.infer<typeof uiToneSchema>;

/** Text that may hold `{{path}}` placeholders. */
const template = z.string().max(4000);

export type UiNode = {
  id: string;
  type: UiNodeType;
  /** Content for text, heading, badge, link, button, markdown; the label of stat/progress. */
  text?: string;
  /** stat value; progress current; chart/list data path; countdown target date. */
  value?: string;
  /** progress maximum (number or `{{path}}`). */
  max?: string;
  /** Under the stat value, beside a heading. */
  caption?: string;
  icon?: string;
  iconColor?: z.infer<typeof iconColorSchema>;
  tone?: UiTone;
  /** image src (a literal https URL, never a placeholder), link and button href. */
  href?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  align?: "start" | "center" | "end" | "between";
  /** stack/row/grid gap in quarter-rems (Tailwind units). */
  gap?: number;
  /** grid columns. */
  columns?: number;
  /** heading level. */
  level?: 1 | 2 | 3;
  /** Repeats the children once per element of the array at this path, as `item` / `index`. */
  repeat?: string;
  /** Rendered only when this path is truthy (prefix `!` to negate). */
  when?: string;
  chart?: {
    kind: "bar" | "line" | "area" | "pie";
    /** Field of each element for the x axis / slice label. */
    x: string;
    /** Field (or fields) plotted. */
    y: string[];
  };
  /** Background / emphasis for card and stack. */
  surface?: "none" | "surface" | "muted" | "accent" | "outline";
  children?: UiNode[];
};

export const UI_NODES_MAX = 400;

export const uiNodeSchema: z.ZodType<UiNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    type: uiNodeTypeSchema,
    text: template.optional(),
    value: template.optional(),
    max: template.optional(),
    caption: template.optional(),
    icon: iconValueSchema.optional(),
    iconColor: iconColorSchema.optional(),
    tone: uiToneSchema.optional(),
    href: template.optional(),
    size: z.enum(["xs", "sm", "md", "lg", "xl"]).optional(),
    align: z.enum(["start", "center", "end", "between"]).optional(),
    gap: z.number().int().min(0).max(16).optional(),
    columns: z.number().int().min(1).max(12).optional(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    repeat: z.string().max(200).optional(),
    when: z.string().max(200).optional(),
    chart: z
      .object({
        kind: z.enum(["bar", "line", "area", "pie"]),
        x: z.string().max(80),
        y: z.array(z.string().max(80)).min(1).max(6),
      })
      .optional(),
    surface: z
      .enum(["none", "surface", "muted", "accent", "outline"])
      .optional(),
    children: z.array(uiNodeSchema).max(200).optional(),
  }),
);

/** Node types that hold children. */
export const UI_CONTAINER_TYPES: readonly UiNodeType[] = [
  "stack",
  "row",
  "grid",
  "card",
  "list",
];

export function countUiNodes(node: UiNode): number {
  return 1 + (node.children ?? []).reduce((n, c) => n + countUiNodes(c), 0);
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

export const COMPONENT_KINDS = ["spec", "html"] as const;
export const componentKindSchema = z.enum(COMPONENT_KINDS);
export type ComponentKind = z.infer<typeof componentKindSchema>;

export const COMPONENT_HTML_MAX = 120_000;

const componentFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(""),
  icon: iconValueSchema.nullable().default(null),
  kind: componentKindSchema,
  /** The tree for `spec`; ignored for `html`. */
  spec: uiNodeSchema
    .refine((node) => countUiNodes(node) <= UI_NODES_MAX, {
      message: `At most ${UI_NODES_MAX} nodes`,
    })
    .nullable()
    .default(null),
  /** Markup, styles and script for `html`; ignored for `spec`. */
  html: z.string().max(COMPONENT_HTML_MAX).default(""),
  css: z.string().max(COMPONENT_HTML_MAX).default(""),
  js: z.string().max(COMPONENT_HTML_MAX).default(""),
  bindings: z
    .array(componentBindingSchema)
    .max(COMPONENT_BINDINGS_MAX)
    .default([]),
  props: z.array(componentPropSchema).max(20).default([]),
  /** Initial height in px for `html`; a script may resize through `component.resize(px)`. */
  height: z.number().int().min(40).max(2000).default(240),
};

export const componentInputSchema = z
  .object(componentFields)
  .refine((c) => c.kind !== "spec" || c.spec !== null, {
    message: "A spec component needs a spec",
    path: ["spec"],
  });
export type ComponentInput = z.input<typeof componentInputSchema>;

export const componentPatchSchema = z
  .object({
    name: componentFields.name,
    description: z.string().max(500),
    icon: iconValueSchema.nullable(),
    kind: componentKindSchema,
    spec: uiNodeSchema.nullable(),
    html: z.string().max(COMPONENT_HTML_MAX),
    css: z.string().max(COMPONENT_HTML_MAX),
    js: z.string().max(COMPONENT_HTML_MAX),
    bindings: z.array(componentBindingSchema).max(COMPONENT_BINDINGS_MAX),
    props: z.array(componentPropSchema).max(20),
    height: componentFields.height,
  })
  .partial();
export type ComponentPatch = z.infer<typeof componentPatchSchema>;

export const workspaceComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  kind: componentKindSchema,
  spec: uiNodeSchema.nullable(),
  html: z.string(),
  css: z.string(),
  js: z.string(),
  bindings: z.array(componentBindingSchema),
  props: z.array(componentPropSchema),
  height: z.number(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkspaceComponent = z.infer<typeof workspaceComponentSchema>;

export const workspaceComponentSummarySchema = workspaceComponentSchema.pick({
  id: true,
  name: true,
  description: true,
  icon: true,
  kind: true,
  createdBy: true,
  updatedAt: true,
});
export type WorkspaceComponentSummary = z.infer<
  typeof workspaceComponentSummarySchema
>;

/** Values a `component` block sets for its component's props. */
export const componentPropValuesSchema = z.record(
  z.string(),
  z.union([z.string().max(2000), z.number(), z.boolean()]),
);
export type ComponentPropValues = z.infer<typeof componentPropValuesSchema>;
