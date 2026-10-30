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
