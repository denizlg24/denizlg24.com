import { z } from "zod";

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

const todoItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

const base = {
  id: z.string(),
  span: blockSpanSchema,
  /** Overrides the block's default label; empty hides the header. */
  title: z.string().optional(),
};

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("heading"), text: z.string() }),
  z.object({ ...base, type: z.literal("text"), markdown: z.string() }),
  z.object({ ...base, type: z.literal("divider") }),
  z.object({
    ...base,
    type: z.literal("todo"),
    items: z.array(todoItemSchema),
  }),
  z.object({
    ...base,
    type: z.literal("links"),
    refs: z.array(workspaceRefSchema),
  }),
  z.object({ ...base, type: z.literal("subpages") }),
  z.object({ ...base, type: z.literal("greeting") }),
  z.object({ ...base, type: z.literal("stats") }),
  z.object({ ...base, type: z.literal("agenda") }),
  z.object({ ...base, type: z.literal("tasks") }),
  z.object({ ...base, type: z.literal("semester") }),
  z.object({ ...base, type: z.literal("alerts") }),
  z.object({ ...base, type: z.literal("budget") }),
  z.object({ ...base, type: z.literal("resources") }),
  z.object({ ...base, type: z.literal("llm") }),
  z.object({ ...base, type: z.literal("notes") }),
  z.object({ ...base, type: z.literal("contacts") }),
  z.object({ ...base, type: z.literal("now") }),
  z.object({ ...base, type: z.literal("board") }),
  z.object({ ...base, type: z.literal("agent") }),
  z.object({
    ...base,
    type: z.literal("modules"),
    /** Section ids to show; empty shows every section. */
    sections: z.array(z.string()),
  }),
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

export const BLOCK_TYPES: BlockType[] = blockSchema.options.map(
  (option) => option.shape.type.value,
);

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
  /** Locked pages refuse layout edits until unlocked. */
  locked: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Set when the page is in the trash. */
  deletedAt: z.string().nullable(),
});
export type WorkspacePage = z.infer<typeof pageSchema>;

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
 * The Notion-style workspace desktop and web share: pages of blocks,
 * favorites, recents and sidebar layout. One document, stored whole.
 */
export const workspaceSchema = z.object({
  version: z.literal(1),
  /** When this copy was last written; reconciles local and server copies. */
  savedAt: z.string().optional(),
  pages: z.record(z.string(), pageSchema),
  favorites: z.array(workspaceRefSchema),
  recents: z.array(workspaceRefSchema),
  sidebar: sidebarPrefsSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;

/**
 * What `PUT /workspace` accepts: the whole v1 document desktop 3.0.0 sends.
 * `baseSavedAt` came from the short-lived web port and is ignored.
 */
export const workspaceSaveSchema = workspaceSchema.extend({
  baseSavedAt: z.string().nullable().optional(),
});
export type WorkspaceSave = z.infer<typeof workspaceSaveSchema>;

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
 * `conversation:` and `task-run:` the in-app agent, forwarded by the MCP server.
 */
export const workspaceActorSchema = z
  .string()
  .regex(
    new RegExp(
      `^(owner|conversation:${ACTOR_ID}|task-run:${ACTOR_ID}|mcp:${ACTOR_ID})$`,
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

/** Null or absent is the page itself; nested parents arrive with document blocks. */
const blockParentSchema = z
  .string()
  .nullable()
  .optional()
  .describe("Parent block id; null or absent is the page root");

/** Absent appends; null puts the block first; an id puts it right after that block. */
const blockAnchorSchema = z
  .string()
  .nullable()
  .optional()
  .describe("Place after this block id; null is first, absent is last");

export const pageMetaPatchSchema = z
  .object({
    title: z.string().max(500),
    icon: z.string().max(32).nullable(),
    fullWidth: z.boolean(),
    locked: z.boolean(),
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
  .describe("Block fields to set; id and type never change");

const insertOpSchema = z.object({
  op: z.literal("insert"),
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

export const HOME_PAGE_ID = "home";
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 248;
