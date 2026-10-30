import { z } from "zod";
import { agentTaskScheduleSchema } from "./agent-tasks";
import {
  ENTITY_KINDS,
  type EntityKind,
  entityRefSchema,
  recordEmbedModeSchema,
} from "./workspace-entities";
import { viewConfigSchema } from "./workspace-views";
import { buttonModeSchema, workflowActionsSchema } from "./workspace-workflows";

export const BLOCK_SPANS = [2, 3, 4, 6] as const;
export const blockSpanSchema = z.union([
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(6),
]);
export type BlockSpan = z.infer<typeof blockSpanSchema>;

/** A sidebar/favorite reference: one of the owner's pages or a built-in module. */
export const workspaceRefSchema = z.string().regex(/^(page|module):.+$/);
export type WorkspaceRef = z.infer<typeof workspaceRefSchema>;

export const pageRef = (id: string): WorkspaceRef => `page:${id}`;
export const moduleRef = (id: string): WorkspaceRef => `module:${id}`;

export function parseRef(
  ref: string,
): { kind: "page" | "module"; id: string } | null {
  const idx = ref.indexOf(":");
  if (idx < 0) return null;
  const kind = ref.slice(0, idx);
  const id = ref.slice(idx + 1);
  if ((kind !== "page" && kind !== "module") || !id) return null;
  return { kind, id };
}

// ---------------------------------------------------------------------------
// Inline rich text: what every text-bearing block holds.
// ---------------------------------------------------------------------------

/** Marks are present only when on, so equal text compares equal. */
export const textRunSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
  bold: z.literal(true).optional(),
  italic: z.literal(true).optional(),
  strike: z.literal(true).optional(),
  code: z.literal(true).optional(),
  link: z.string().min(1).max(2048).optional(),
});
export type TextRun = z.infer<typeof textRunSchema>;

/** A date, or any entity kind (page and person among them). */
export const MENTION_KINDS = [
  "page",
  "person",
  "date",
  "note",
  "kanban-board",
  "kanban-card",
  "whiteboard",
  "course",
  "envelope",
  "paper",
  "voice-note",
  "latex-project",
  "calendar-event",
] as const satisfies readonly (EntityKind | "date")[];
export const mentionKindSchema = z.enum(MENTION_KINDS);
export type MentionKind = z.infer<typeof mentionKindSchema>;
// Every entity kind can be mentioned.
const _everyEntityMentionable: readonly MentionKind[] = ENTITY_KINDS;
void _everyEntityMentionable;

/**
 * A page (live title), a date (`id` is `YYYY-MM-DD`) or any other record
 * (`label` is its title when mentioned; the record's own wins when it loads).
 */
export const mentionRunSchema = z.object({
  type: z.literal("mention"),
  kind: mentionKindSchema,
  id: z.string().min(1).max(128),
  label: z.string().max(200).optional(),
});
export type MentionRun = z.infer<typeof mentionRunSchema>;

export const inlineRunSchema = z.discriminatedUnion("type", [
  textRunSchema,
  mentionRunSchema,
]);
export type InlineRun = z.infer<typeof inlineRunSchema>;

export const richTextSchema = z.array(inlineRunSchema);
export type RichText = z.infer<typeof richTextSchema>;

// ---------------------------------------------------------------------------
// Blocks: a page is a flow of them, nested where a type has `children`.
// ---------------------------------------------------------------------------

export const CALLOUT_COLORS = [
  "default",
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
export const calloutColorSchema = z.enum(CALLOUT_COLORS);
export type CalloutColor = z.infer<typeof calloutColorSchema>;

export const headingLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type HeadingLevel = z.infer<typeof headingLevelSchema>;

const id = { id: z.string().min(1).max(64) };
/** Widgets keep v1's header override; empty hides the header. */
const widget = { ...id, title: z.string().optional() };
const text = { ...id, text: richTextSchema };

const paragraphSchema = z.object({
  ...text,
  type: z.literal("paragraph"),
});
const headingSchema = z.object({
  ...text,
  type: z.literal("heading"),
  level: headingLevelSchema,
});
// Recursive schemas spell their fields out: a spread beside a getter makes
// TypeScript resolve the getter's type eagerly and give up on the cycle.
const bulletSchema = z.object({
  id: z.string().min(1).max(64),
  text: richTextSchema,
  type: z.literal("bullet"),
  get children(): z.ZodDefault<z.ZodArray<typeof blockSchema>> {
    return z.array(blockSchema).default([]);
  },
});
const numberedSchema = z.object({
  id: z.string().min(1).max(64),
  text: richTextSchema,
  type: z.literal("numbered"),
  get children(): z.ZodDefault<z.ZodArray<typeof blockSchema>> {
    return z.array(blockSchema).default([]);
  },
});
const todoSchema = z.object({
  id: z.string().min(1).max(64),
  text: richTextSchema,
  type: z.literal("todo"),
  checked: z.boolean().default(false),
  get children(): z.ZodDefault<z.ZodArray<typeof blockSchema>> {
    return z.array(blockSchema).default([]);
  },
});
/** With `level` it is a toggle heading. */
const toggleSchema = z.object({
  id: z.string().min(1).max(64),
  text: richTextSchema,
  type: z.literal("toggle"),
  level: headingLevelSchema.optional(),
  get children(): z.ZodDefault<z.ZodArray<typeof blockSchema>> {
    return z.array(blockSchema).default([]);
  },
});
const calloutSchema = z.object({
  id: z.string().min(1).max(64),
  text: richTextSchema,
  type: z.literal("callout"),
  emoji: z.string().max(32).default("💡"),
  color: calloutColorSchema.default("default"),
  get children(): z.ZodDefault<z.ZodArray<typeof blockSchema>> {
    return z.array(blockSchema).default([]);
  },
});
const quoteSchema = z.object({
  id: z.string().min(1).max(64),
  text: richTextSchema,
  type: z.literal("quote"),
  get children(): z.ZodDefault<z.ZodArray<typeof blockSchema>> {
    return z.array(blockSchema).default([]);
  },
});
const codeSchema = z.object({
  ...id,
  type: z.literal("code"),
  code: z.string(),
  language: z.string().max(40).default(""),
});
const dividerSchema = z.object({ ...id, type: z.literal("divider") });
const imageSchema = z.object({
  ...id,
  type: z.literal("image"),
  /** Empty until something is uploaded or linked. */
  url: z.string().max(4096),
  caption: richTextSchema.default([]),
});
const fileSchema = z.object({
  ...id,
  type: z.literal("file"),
  url: z.string().max(4096),
  name: z.string().max(500),
  size: z.number().int().min(0).optional(),
});
/** Title and the rest come from the server's unfurl; absent until it answered. */
const bookmarkSchema = z.object({
  ...id,
  type: z.literal("bookmark"),
  url: z.string().max(4096),
  title: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  image: z.string().max(4096).optional(),
  siteName: z.string().max(200).optional(),
});
const equationSchema = z.object({
  ...id,
  type: z.literal("equation"),
  /** KaTeX source, display mode. */
  expression: z.string(),
});
const tableSchema = z.object({
  ...id,
  type: z.literal("table"),
  /** Rows of cells; every row has the same number of cells. */
  rows: z.array(z.array(richTextSchema)),
  headerRow: z.boolean().default(true),
});
const tocSchema = z.object({ ...id, type: z.literal("toc") });
const breadcrumbSchema = z.object({ ...id, type: z.literal("breadcrumb") });
/** Renders `blockId` from `pageId`; edits go to that page. Empty until a source is picked. */
const syncedSchema = z.object({
  ...id,
  type: z.literal("synced"),
  pageId: z.string().max(64),
  blockId: z.string().max(64),
});
/** One record of a module or a page, as a card or the module's own view. Empty `ref` until picked. */
const recordSchema = z.object({
  ...id,
  type: z.literal("record"),
  ref: z.union([entityRefSchema, z.literal("")]),
  mode: recordEmbedModeSchema.default("card"),
});
/** A live query over one module; see `workspace-views`. */
const viewSchema = z.object({
  ...widget,
  type: z.literal("view"),
  ...viewConfigSchema.shape,
});
/**
 * Runs its actions in order, or starts a background agent run with the page
 * as context, when pressed. Leaf: what it last started is looked up, not stored.
 */
const buttonSchema = z.object({
  ...id,
  type: z.literal("button"),
  label: z.string().max(120),
  mode: buttonModeSchema.default("actions"),
  actions: workflowActionsSchema.default([]),
  agentPrompt: z.string().max(8_000).default(""),
});
/** What an agent section may read: a record (a page reads as its markdown) or a view block's rows. */
export const sectionSourceSchema = z.union([
  entityRefSchema,
  z
    .string()
    .regex(/^view:[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/)
    .describe("view:<pageId>:<blockId>, a view block's rows"),
]);
export type SectionSource = z.infer<typeof sectionSourceSchema>;
export const SECTION_SOURCES_MAX = 10;
/** Blocks one run may write into a section, nested ones counted. */
export const SECTION_BLOCKS_MAX = 60;

/**
 * Children an agent task writes. Each run replaces them through ops by the
 * task run, unless the section is pinned or someone edited inside it since
 * the last run: then the run leaves a proposal to accept or reject.
 */
const sectionSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal("section"),
  title: z.string().max(200).default(""),
  prompt: z.string().max(8_000).default(""),
  /** Null runs only on demand. */
  schedule: agentTaskScheduleSchema.nullable().default(null),
  sources: z.array(sectionSourceSchema).max(SECTION_SOURCES_MAX).default([]),
  pinned: z.boolean().default(false),
  get children(): z.ZodDefault<z.ZodArray<typeof blockSchema>> {
    return z.array(blockSchema).default([]);
  },
});
/** A share of its row: the widths of a `columns` block's columns are normalised to sum to 1. */
const columnSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal("column"),
  width: z.number().positive().max(1),
  get children(): z.ZodDefault<z.ZodArray<typeof blockSchema>> {
    return z.array(blockSchema).default([]);
  },
});
const columnsSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.literal("columns"),
  get children(): z.ZodDefault<z.ZodArray<typeof columnSchema>> {
    return z.array(columnSchema).default([]);
  },
});

export const blockSchema = z.discriminatedUnion("type", [
  paragraphSchema,
  headingSchema,
  bulletSchema,
  numberedSchema,
  todoSchema,
  toggleSchema,
  calloutSchema,
  quoteSchema,
  codeSchema,
  dividerSchema,
  imageSchema,
  fileSchema,
  bookmarkSchema,
  equationSchema,
  tableSchema,
  tocSchema,
  breadcrumbSchema,
  syncedSchema,
  recordSchema,
  viewSchema,
  buttonSchema,
  sectionSchema,
  columnsSchema,
  columnSchema,
  z.object({
    ...widget,
    type: z.literal("links"),
    refs: z.array(workspaceRefSchema),
  }),
  z.object({ ...widget, type: z.literal("subpages") }),
  z.object({ ...widget, type: z.literal("greeting") }),
  z.object({ ...widget, type: z.literal("stats") }),
  z.object({ ...widget, type: z.literal("agenda") }),
  z.object({ ...widget, type: z.literal("tasks") }),
  z.object({ ...widget, type: z.literal("semester") }),
  z.object({ ...widget, type: z.literal("alerts") }),
  z.object({ ...widget, type: z.literal("budget") }),
  z.object({ ...widget, type: z.literal("resources") }),
  z.object({ ...widget, type: z.literal("llm") }),
  z.object({ ...widget, type: z.literal("notes") }),
  z.object({ ...widget, type: z.literal("contacts") }),
  z.object({ ...widget, type: z.literal("now") }),
  z.object({ ...widget, type: z.literal("board") }),
  z.object({ ...widget, type: z.literal("agent") }),
  z.object({
    ...widget,
    type: z.literal("modules"),
    /** Section ids to show; empty shows every section. */
    sections: z.array(z.string()),
  }),
]);
export type Block = z.infer<typeof blockSchema>;
/** A block as a client or agent may send it: defaults (children, checked…) optional. */
export type BlockInput = z.input<typeof blockSchema>;
export type BlockType = Block["type"];
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;
export type ContainerBlock = Extract<Block, { children: unknown }>;
export type TextBlock = Extract<Block, { text: RichText }>;

export const BLOCK_TYPES: BlockType[] = blockSchema.options.map(
  (option) => option.shape.type.value,
);
export const blockTypeSchema = z.enum(
  BLOCK_TYPES as [BlockType, ...BlockType[]],
);

export const CONTAINER_TYPES = [
  "bullet",
  "numbered",
  "todo",
  "toggle",
  "callout",
  "quote",
  "columns",
  "column",
  "section",
] as const satisfies readonly ContainerBlock["type"][];

export const TEXT_TYPES = [
  "paragraph",
  "heading",
  "bullet",
  "numbered",
  "todo",
  "toggle",
  "callout",
  "quote",
] as const satisfies readonly TextBlock["type"][];

export const WIDGET_TYPES = [
  "links",
  "subpages",
  "greeting",
  "stats",
  "agenda",
  "tasks",
  "semester",
  "alerts",
  "budget",
  "resources",
  "llm",
  "notes",
  "contacts",
  "now",
  "board",
  "agent",
  "modules",
] as const satisfies readonly BlockType[];
export type WidgetType = (typeof WIDGET_TYPES)[number];

export function isContainer(block: Block): block is ContainerBlock {
  return "children" in block;
}

export function isTextBlock(block: Block): block is TextBlock {
  return "text" in block;
}

export function isWidgetType(type: BlockType): type is WidgetType {
  return (WIDGET_TYPES as readonly BlockType[]).includes(type);
}

export const pageSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** An emoji; null shows the default page glyph. */
  icon: z.string().nullable(),
  parentId: z.string().nullable(),
  /** Sort key among siblings. */
  order: z.number(),
  blocks: z.array(blockSchema),
  fullWidth: z.boolean(),
  /** Locked pages are read-only to everyone but an unlocking owner. */
  locked: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Set when the page is in the trash. */
  deletedAt: z.string().nullable(),
  /**
   * A template: listed only under Templates, copied by "new from template".
   * Present only when true, so pages from before templates compare equal.
   */
  template: z.literal(true).optional(),
});
export type WorkspacePage = z.infer<typeof pageSchema>;

// ---------------------------------------------------------------------------
// v1: the grid desktop 3.0.0 still reads and writes through GET|PUT /workspace.
// Frozen; nothing new is stored in this shape.
// ---------------------------------------------------------------------------

const legacyTodoItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
});
export type LegacyTodoItem = z.infer<typeof legacyTodoItemSchema>;

const legacyBase = {
  id: z.string(),
  span: blockSpanSchema,
  /** Overrides the block's default label; empty hides the header. */
  title: z.string().optional(),
};

export const legacyBlockSchema = z.discriminatedUnion("type", [
  z.object({ ...legacyBase, type: z.literal("heading"), text: z.string() }),
  z.object({ ...legacyBase, type: z.literal("text"), markdown: z.string() }),
  z.object({ ...legacyBase, type: z.literal("divider") }),
  z.object({
    ...legacyBase,
    type: z.literal("todo"),
    items: z.array(legacyTodoItemSchema),
  }),
  z.object({
    ...legacyBase,
    type: z.literal("links"),
    refs: z.array(workspaceRefSchema),
  }),
  z.object({ ...legacyBase, type: z.literal("subpages") }),
  z.object({ ...legacyBase, type: z.literal("greeting") }),
  z.object({ ...legacyBase, type: z.literal("stats") }),
  z.object({ ...legacyBase, type: z.literal("agenda") }),
  z.object({ ...legacyBase, type: z.literal("tasks") }),
  z.object({ ...legacyBase, type: z.literal("semester") }),
  z.object({ ...legacyBase, type: z.literal("alerts") }),
  z.object({ ...legacyBase, type: z.literal("budget") }),
  z.object({ ...legacyBase, type: z.literal("resources") }),
  z.object({ ...legacyBase, type: z.literal("llm") }),
  z.object({ ...legacyBase, type: z.literal("notes") }),
  z.object({ ...legacyBase, type: z.literal("contacts") }),
  z.object({ ...legacyBase, type: z.literal("now") }),
  z.object({ ...legacyBase, type: z.literal("board") }),
  z.object({ ...legacyBase, type: z.literal("agent") }),
  z.object({
    ...legacyBase,
    type: z.literal("modules"),
    sections: z.array(z.string()),
  }),
]);
export type LegacyBlock = z.infer<typeof legacyBlockSchema>;
export type LegacyBlockType = LegacyBlock["type"];

export const legacyPageSchema = pageSchema.extend({
  blocks: z.array(legacyBlockSchema),
});
export type LegacyPage = z.infer<typeof legacyPageSchema>;

export const sidebarPrefsSchema = z.object({
  width: z.number(),
  collapsed: z.boolean(),
  hiddenModules: z.array(z.string()),
  collapsedSections: z.array(z.string()),
  /** Page ids whose children are expanded in the tree. */
  expandedPages: z.array(z.string()),
});
export type SidebarPrefs = z.infer<typeof sidebarPrefsSchema>;

/**
 * The whole v1 document: what `GET|PUT /workspace` exchanges with desktop
 * 3.0.0, and what the `DesktopWorkspace` singleton held before pages.
 */
export const legacyWorkspaceSchema = z.object({
  version: z.literal(1),
  /** When this copy was last written; reconciles local and server copies. */
  savedAt: z.string().optional(),
  pages: z.record(z.string(), legacyPageSchema),
  favorites: z.array(workspaceRefSchema),
  recents: z.array(workspaceRefSchema),
  sidebar: sidebarPrefsSchema,
});
export type LegacyWorkspace = z.infer<typeof legacyWorkspaceSchema>;

/**
 * The workspace as a client holds it: pages of blocks, favorites, recents and
 * sidebar layout. Storage is per page (below); this is the client's state and
 * desktop's device cache. A 3.0.0 cache (version 1) is not read.
 */
export const workspaceSchema = z.object({
  version: z.literal(2),
  savedAt: z.string().optional(),
  pages: z.record(z.string(), pageSchema),
  favorites: z.array(workspaceRefSchema),
  recents: z.array(workspaceRefSchema),
  sidebar: sidebarPrefsSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;

/** The device copy desktop keeps for an instant launch: the v1 shape plus each page's rev. */
export const workspaceCacheSchema = workspaceSchema.extend({
  revs: z.record(z.string(), z.number().int()).optional(),
});
export type WorkspaceCache = z.infer<typeof workspaceCacheSchema>;

// ---------------------------------------------------------------------------
// v2 storage: one document per page, an op log, prefs on their own.
// ---------------------------------------------------------------------------

const ACTOR_ID = "[A-Za-z0-9_.-]{1,96}";

/**
 * Who made a change. `owner` is a signed-in session (web, desktop, an API
 * key); `mcp:<clientId>` a service client with no finer attribution;
 * `conversation:` and `task-run:` the in-app agent, forwarded by the MCP
 * server; `migration` the server turning a v1 grid page into a flow.
 */
export const workspaceActorSchema = z
  .string()
  .regex(
    new RegExp(
      `^(owner|migration|conversation:${ACTOR_ID}|task-run:${ACTOR_ID}|mcp:${ACTOR_ID})$`,
    ),
  );
export type WorkspaceActor = z.infer<typeof workspaceActorSchema>;

/** The in-app agent's identity, as web sends it to the primary connector and MCP forwards it back. */
export const AGENT_ACTOR_HEADER = "x-agent-actor";
export const agentRunActorSchema = z
  .string()
  .regex(new RegExp(`^(conversation|task-run):${ACTOR_ID}$`));

export const blockIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("Block id");

/** Null or absent is the page itself; otherwise a container block. */
const blockParentSchema = z
  .string()
  .nullable()
  .optional()
  .describe(
    "Parent block id (toggle, list item, callout, quote, column; a column's parent is a columns block); null or absent is the page root",
  );

/** Absent appends; null puts the block first; an id puts it right after that sibling. */
const blockAnchorSchema = z
  .string()
  .nullable()
  .optional()
  .describe("Place after this sibling block id; null is first, absent is last");

export const pageMetaPatchSchema = z
  .object({
    title: z.string().max(500),
    icon: z.string().max(32).nullable(),
    fullWidth: z.boolean(),
    locked: z.boolean(),
    template: z.boolean(),
  })
  .partial();
export type PageMetaPatch = z.infer<typeof pageMetaPatchSchema>;

/** Placement and trash state; written by move/archive/restore, never by a public op. */
const pageStructurePatchSchema = z
  .object({
    parentId: z.string().nullable(),
    order: z.number(),
    deletedAt: z.string().nullable(),
  })
  .partial();

const blockFieldsSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "Block fields to set; id never changes and children move only through insert, move and delete",
  );

const insertOpSchema = z.object({
  op: z.literal("insert"),
  /** With its subtree: every id in it must be new to the page. */
  block: blockSchema,
  parentId: blockParentSchema,
  after: blockAnchorSchema,
});
const updateOpSchema = z.object({
  op: z.literal("update"),
  id: blockIdSchema,
  set: blockFieldsSchema,
  /** Replaces every field instead of merging into the current block. */
  replace: z.boolean().optional(),
  /** Turns the block into another type, keeping its id; its children must fit the new type. */
  type: blockTypeSchema.optional(),
});
const moveOpSchema = z.object({
  op: z.literal("move"),
  id: blockIdSchema,
  parentId: blockParentSchema,
  after: blockAnchorSchema,
});
const deleteOpSchema = z.object({
  op: z.literal("delete"),
  id: blockIdSchema,
});

/** An edit a client or agent sends. */
export const workspaceOpSchema = z.discriminatedUnion("op", [
  insertOpSchema,
  updateOpSchema,
  moveOpSchema,
  deleteOpSchema,
  z.object({ op: z.literal("page"), set: pageMetaPatchSchema }),
]);
export type WorkspaceOp = z.infer<typeof workspaceOpSchema>;

/**
 * An op as the log stores it: resolved (anchors concrete, updates whole) so
 * replaying it is deterministic, plus the server-only kinds.
 */
export const workspaceAppliedOpSchema = z.discriminatedUnion("op", [
  insertOpSchema,
  updateOpSchema,
  moveOpSchema,
  deleteOpSchema,
  z.object({
    op: z.literal("page"),
    set: pageMetaPatchSchema.extend(pageStructurePatchSchema.shape),
  }),
  z.object({ op: z.literal("replace"), blocks: z.array(blockSchema) }),
]);
export type WorkspaceAppliedOp = z.infer<typeof workspaceAppliedOpSchema>;

export const WORKSPACE_OPS_MAX = 200;

export const workspaceOpsRequestSchema = z.object({
  /** The rev the ops were written against. */
  baseRev: z.number().int().min(0),
  ops: z.array(workspaceOpSchema).min(1).max(WORKSPACE_OPS_MAX),
});
export type WorkspaceOpsRequest = z.infer<typeof workspaceOpsRequestSchema>;

export const workspacePageDocSchema = pageSchema.extend({
  rev: z.number().int().min(0),
});
export type WorkspacePageDoc = z.infer<typeof workspacePageDocSchema>;

export const workspacePageSummarySchema = pageSchema
  .omit({ blocks: true })
  .extend({
    rev: z.number().int().min(0),
    blockCount: z.number().int().min(0),
  });
export type WorkspacePageSummary = z.infer<typeof workspacePageSummarySchema>;

export const workspacePrefsInputSchema = z.object({
  favorites: z.array(workspaceRefSchema),
  recents: z.array(workspaceRefSchema),
  sidebar: sidebarPrefsSchema,
});
export type WorkspacePrefsInput = z.infer<typeof workspacePrefsInputSchema>;

export const workspacePrefsSchema = workspacePrefsInputSchema.extend({
  updatedAt: z.string(),
});
export type WorkspacePrefs = z.infer<typeof workspacePrefsSchema>;

export const workspacePageIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("Workspace page id");

export const workspacePageCreateSchema = z.object({
  /** Clients mint ids so a page can be linked before the server answers. */
  id: workspacePageIdSchema.optional(),
  title: z.string().max(500).default(""),
  icon: z.string().max(32).nullable().default(null),
  parentId: workspacePageIdSchema.nullable().default(null),
  /** Position among its siblings; absent appends. */
  index: z.number().int().min(0).optional(),
  blocks: z.array(blockSchema).max(WORKSPACE_OPS_MAX).default([]),
  fullWidth: z.boolean().default(false),
  locked: z.boolean().default(false),
  template: z.boolean().default(false),
});
export type WorkspacePageCreate = z.input<typeof workspacePageCreateSchema>;

export const workspacePageMoveSchema = z.object({
  parentId: workspacePageIdSchema.nullable(),
  /** Position among the new siblings; absent appends. */
  index: z.number().int().min(0).optional(),
});
export type WorkspacePageMove = z.infer<typeof workspacePageMoveSchema>;

export const WORKSPACE_REVISION_KINDS = [
  "migrate",
  "create",
  "ops",
  "meta",
  "move",
  "archive",
  "restore",
  "replace",
  "revert",
  "compat",
] as const;
export const workspaceRevisionKindSchema = z.enum(WORKSPACE_REVISION_KINDS);
export type WorkspaceRevisionKind = z.infer<typeof workspaceRevisionKindSchema>;

export const workspaceRevisionSummarySchema = z.object({
  rev: z.number().int(),
  actor: workspaceActorSchema,
  /** The credential that carried an agent actor, e.g. `mcp:<clientId>`. */
  via: z.string().nullable(),
  kind: workspaceRevisionKindSchema,
  at: z.string(),
  opCount: z.number().int(),
  touched: z.array(z.string()),
  snapshot: z.boolean(),
});
export type WorkspaceRevisionSummary = z.infer<
  typeof workspaceRevisionSummarySchema
>;

export const workspaceRevertSchema = z
  .object({
    /** Restore the page to how it stood at this rev. */
    rev: z.number().int().min(1).optional(),
    /** Undo this actor's ops, newest first. */
    actor: workspaceActorSchema.optional(),
    /** With `actor`: only revisions after this rev. */
    sinceRev: z.number().int().min(0).optional(),
  })
  .refine(
    (value) => (value.rev === undefined) !== (value.actor === undefined),
    {
      message: "Exactly one of rev or actor",
    },
  );
export type WorkspaceRevert = z.infer<typeof workspaceRevertSchema>;

export const workspaceMarkdownPutSchema = z.object({
  baseRev: z.number().int().min(0),
  markdown: z.string().max(400_000),
});
export type WorkspaceMarkdownPut = z.infer<typeof workspaceMarkdownPutSchema>;

export const workspaceChangesSchema = z.object({
  /** Pass back as `since` on the next poll. */
  cursor: z.string(),
  pages: z.array(workspacePageSummarySchema),
  /** Pages deleted for good since the cursor. */
  purged: z.array(z.string()),
  prefsUpdatedAt: z.string().nullable(),
});
export type WorkspaceChanges = z.infer<typeof workspaceChangesSchema>;

export const workspaceUnfurlRequestSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(4096),
});

export const workspaceUnfurlSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  siteName: z.string().optional(),
});
export type WorkspaceUnfurl = z.infer<typeof workspaceUnfurlSchema>;

export const HOME_PAGE_ID = "home";
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 248;

// ---------------------------------------------------------------------------
// Agent sections: what a section block's runs left behind.
// ---------------------------------------------------------------------------

export const SECTION_OUTCOMES = [
  "written",
  "proposed",
  "unchanged",
  "failed",
] as const;
export const sectionOutcomeSchema = z.enum(SECTION_OUTCOMES);
export type SectionOutcome = z.infer<typeof sectionOutcomeSchema>;

export const sectionRunSchema = z.object({
  runId: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  at: z.string(),
  outcome: sectionOutcomeSchema.optional(),
  error: z.string().optional(),
});
export type SectionRun = z.infer<typeof sectionRunSchema>;

export const sectionProposalSchema = z.object({
  runId: z.string(),
  at: z.string(),
  blocks: z.array(blockSchema),
});
export type SectionProposal = z.infer<typeof sectionProposalSchema>;

export const sectionStateSchema = z.object({
  pageId: z.string(),
  blockId: z.string(),
  /** The agent task that runs it; null until the section has a prompt. */
  taskId: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  lastRun: sectionRunSchema.nullable(),
  proposal: sectionProposalSchema.nullable(),
  /** Its children differ from what the last run wrote: the next run proposes. */
  edited: z.boolean(),
});
export type SectionState = z.infer<typeof sectionStateSchema>;

export const sectionDecisionSchema = z.object({
  decision: z.enum(["accept", "reject"]),
});
export type SectionDecision = z.infer<typeof sectionDecisionSchema>;
