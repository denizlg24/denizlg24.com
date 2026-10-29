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
 * A save: the workspace plus the `savedAt` of the server copy it was edited
 * from (null when the server held none). Two clients write this document, so
 * the server refuses a save whose base is no longer what it stores. A body
 * without `baseSavedAt` (desktop 3.0.0) is written unconditionally.
 */
export const workspaceSaveSchema = workspaceSchema.extend({
  baseSavedAt: z.string().nullable().optional(),
});
export type WorkspaceSave = z.infer<typeof workspaceSaveSchema>;

export const HOME_PAGE_ID = "home";
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 248;
