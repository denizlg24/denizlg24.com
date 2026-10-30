import { z } from "zod";

/*
 * Workflows over the workspace: templates, button actions, event triggers.
 * Block shapes that carry these (button, agent section) live in `workspace`;
 * this file holds what they reference, and nothing here imports blocks.
 */

const pageIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("Workspace page id");
const blockIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("Block id");

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Variables a template may use, as `{{name}}`. `date`, `time`, `week` and
 * `weekday` are read in the app's time zone when the template is used;
 * `page.title` is the title of the page the blocks land in. A prompted input
 * is `{{input:Name}}`, asked once per instantiation.
 */
export const TEMPLATE_VARIABLES = [
  "date",
  "time",
  "week",
  "weekday",
  "page.title",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const TEMPLATE_INPUT_NAME_MAX = 60;

export const templateInputsSchema = z
  .record(z.string().min(1).max(TEMPLATE_INPUT_NAME_MAX), z.string().max(2_000))
  .refine((inputs) => Object.keys(inputs).length <= 20, {
    message: "At most 20 inputs",
  })
  .describe("Values for the template's {{input:Name}} prompts, by name");
export type TemplateInputs = z.infer<typeof templateInputsSchema>;

export const workspaceTemplateSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  /** Names of its `{{input:Name}}` prompts, in first-seen order. */
  inputs: z.array(z.string()),
  blockCount: z.number().int().min(0),
  updatedAt: z.string(),
});
export type WorkspaceTemplateSummary = z.infer<
  typeof workspaceTemplateSummarySchema
>;

/** A new page from a template. */
export const templateInstantiateSchema = z.object({
  parentId: pageIdSchema
    .nullable()
    .default(null)
    .describe("Parent page id; null is the top level"),
  /** Overrides the template's own title; variables apply to it too. */
  title: z.string().max(500).optional(),
  inputs: templateInputsSchema.default({}),
  index: z.number().int().min(0).optional(),
});
export type TemplateInstantiate = z.input<typeof templateInstantiateSchema>;

/** A template's blocks inserted into an existing page. */
export const templateInsertSchema = z.object({
  pageId: pageIdSchema,
  parentId: blockIdSchema
    .nullable()
    .optional()
    .describe("Container block to insert into; absent is the page root"),
  after: blockIdSchema
    .nullable()
    .optional()
    .describe("Insert after this sibling; null is first, absent is last"),
  inputs: templateInputsSchema.default({}),
});
export type TemplateInsert = z.input<typeof templateInsertSchema>;

/** Blocks of one page copied into a new template page. */
export const templateFromBlocksSchema = z.object({
  pageId: pageIdSchema,
  blockIds: z.array(blockIdSchema).min(1).max(200),
  title: z.string().max(500).default(""),
});
export type TemplateFromBlocks = z.input<typeof templateFromBlocksSchema>;

// ---------------------------------------------------------------------------
// Actions: what a button (and a trigger) does
// ---------------------------------------------------------------------------

/** "The page holding the button"; a trigger has none, and an action naming it fails. */
export const THIS_PAGE = "$this";

const pageTargetSchema = z
  .union([z.literal(THIS_PAGE), pageIdSchema])
  .describe("A page id, or $this for the page holding the button");
const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/);

/**
 * One step of a button or trigger. Text fields may hold template variables
 * (`{{date}}`, `{{input:Name}}`, and in a trigger `{{event.<field>}}`), filled
 * when the action runs.
 */
export const workflowActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create-page"),
    templateId: pageIdSchema,
    parentId: pageTargetSchema
      .nullable()
      .default(null)
      .describe("Parent page; null is the top level"),
    title: z.string().max(500).optional(),
    inputs: templateInputsSchema.default({}),
  }),
  z.object({
    kind: z.literal("append-blocks"),
    pageId: pageTargetSchema.default(THIS_PAGE),
    /** Workspace markdown, appended at the end of the page. */
    markdown: z.string().min(1).max(20_000),
  }),
  z.object({
    kind: z.literal("insert-template"),
    templateId: pageIdSchema,
    inputs: templateInputsSchema.default({}),
  }),
  z.object({
    kind: z.literal("create-card"),
    boardId: objectIdSchema,
    columnId: objectIdSchema,
    title: z.string().min(1).max(300),
    description: z.string().max(5_000).optional(),
    /** `YYYY-MM-DD` once variables are filled. */
    dueDate: z.string().max(60).optional(),
  }),
  z.object({
    kind: z.literal("create-event"),
    title: z.string().min(1).max(300),
    /** `YYYY-MM-DD` once variables are filled. */
    date: z.string().min(1).max(60),
    /** `HH:MM` local; absent is an all-day event. */
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    durationMinutes: z.number().int().min(5).max(1_440).default(60),
    place: z.string().max(300).optional(),
  }),
  z.object({
    kind: z.literal("set-todo"),
    pageId: pageTargetSchema.default(THIS_PAGE),
    blockId: blockIdSchema,
    checked: z.boolean(),
  }),
  z.object({
    kind: z.literal("open"),
    /** A URL, or an app path starting with `/`; only a person's click opens it. */
    url: z.string().min(1).max(2_048),
  }),
]);
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
export type WorkflowActionInput = z.input<typeof workflowActionSchema>;
export type WorkflowActionKind = WorkflowAction["kind"];
export const WORKFLOW_ACTION_KINDS = [
  "create-page",
  "append-blocks",
  "insert-template",
  "create-card",
  "create-event",
  "set-todo",
  "open",
] as const satisfies readonly WorkflowActionKind[];
// Every kind is listed.
const _everyActionKind: readonly (typeof WORKFLOW_ACTION_KINDS)[number][] =
  workflowActionSchema.options.map((option) => option.shape.kind.value);
void _everyActionKind;

export const WORKFLOW_ACTIONS_MAX = 10;
export const workflowActionsSchema = z
  .array(workflowActionSchema)
  .max(WORKFLOW_ACTIONS_MAX);

/** What one action did; actions run in order and a failure does not stop the next. */
export const workflowActionResultSchema = z.object({
  index: z.number().int().min(0),
  kind: z.enum(WORKFLOW_ACTION_KINDS),
  ok: z.boolean(),
  /** A refused or failed action's reason. */
  error: z.string().optional(),
  /** Not run: `open` without a person to open it for. */
  skipped: z.boolean().optional(),
  pageId: z.string().optional(),
  blockIds: z.array(z.string()).optional(),
  cardId: z.string().optional(),
  eventId: z.string().optional(),
  url: z.string().optional(),
});
export type WorkflowActionResult = z.infer<typeof workflowActionResultSchema>;

export const BUTTON_MODES = ["actions", "agent"] as const;
export const buttonModeSchema = z.enum(BUTTON_MODES);
export type ButtonMode = z.infer<typeof buttonModeSchema>;

/** Presses the button block `blockId` on page `pageId`. */
export const buttonRunRequestSchema = z.object({
  pageId: pageIdSchema,
  blockId: blockIdSchema,
});
export type ButtonRunRequest = z.infer<typeof buttonRunRequestSchema>;

export const agentRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

/** The background run a button started, as the block shows it. */
export const buttonAgentRunSchema = z.object({
  runId: z.string(),
  conversationId: z.string(),
  status: agentRunStatusSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});
export type ButtonAgentRun = z.infer<typeof buttonAgentRunSchema>;

export const buttonRunResponseSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("actions"),
    results: z.array(workflowActionResultSchema),
  }),
  z.object({ mode: z.literal("agent"), run: buttonAgentRunSchema }),
]);
export type ButtonRunResponse = z.infer<typeof buttonRunResponseSchema>;
