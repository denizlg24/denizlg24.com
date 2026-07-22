import { z } from "zod";
import { latexProjectSchema } from "./settings";

export const latexCompileStatusSchema = z.enum([
  "never",
  "stale",
  "compiling",
  "ready",
  "error",
]);
export type LatexCompileStatus = z.infer<typeof latexCompileStatusSchema>;

export const latexIngestionStatusSchema = z.enum([
  "idle",
  "pending",
  "indexing",
  "ready",
  "error",
]);
export type LatexIngestionStatus = z.infer<typeof latexIngestionStatusSchema>;

export const latexProjectSettingsSchema = z.object({
  grammarDialect: z.enum(["american", "british"]).default("american"),
  bibliographyFile: z.string().max(240).nullable().default(null),
  inlineCompletionEnabled: z.boolean().default(true),
  inlineCompletionModel: z.string().min(1).max(200).nullable().default(null),
  agentProvider: z.enum(["hosted", "ollama"]).default("hosted"),
  agentModel: z.string().min(1).max(200).nullable().default(null),
  embeddingProvider: z.enum(["hosted", "ollama"]).default("hosted"),
  embeddingModel: z.string().min(1).max(200).nullable().default(null),
  agentMemoryMode: z.enum(["enabled", "retrieval-off"]).default("enabled"),
});
export type LatexProjectSettings = z.infer<typeof latexProjectSettingsSchema>;

export const latexCompiledPdfSchema = z.object({
  filename: z.string().min(1).max(240),
  size: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});
export type LatexCompiledPdf = z.infer<typeof latexCompiledPdfSchema>;

export const latexProjectIngestionSchema = z.object({
  status: latexIngestionStatusSchema,
  updatedAt: z.iso.datetime().nullable(),
  error: z.string().max(2_000).nullable(),
});
export type LatexProjectIngestion = z.infer<typeof latexProjectIngestionSchema>;

export const latexProjectRecordSchema = z.object({
  _id: z.string(),
  name: z.string().trim().min(1).max(100),
  project: latexProjectSchema,
  revision: z.number().int().nonnegative(),
  compileCount: z.number().int().nonnegative().default(0),
  archivedAt: z.iso.datetime().nullable(),
  compileStatus: latexCompileStatusSchema,
  compileError: z.string().max(20_000).nullable(),
  compiledPdf: latexCompiledPdfSchema.nullable(),
  settings: latexProjectSettingsSchema,
  ingestion: latexProjectIngestionSchema,
  conversationId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ILatexProjectRecord = z.infer<typeof latexProjectRecordSchema>;

export const latexProjectSummarySchema = latexProjectRecordSchema.omit({
  project: true,
  compileError: true,
});
export type LatexProjectSummary = z.infer<typeof latexProjectSummarySchema>;

export const latexProjectsResponseSchema = z.object({
  projects: z.array(latexProjectSummarySchema),
});
export type LatexProjectsResponse = z.infer<typeof latexProjectsResponseSchema>;

export const latexProjectResponseSchema = z.object({
  project: latexProjectRecordSchema,
});
export type LatexProjectResponse = z.infer<typeof latexProjectResponseSchema>;

export const createLatexProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  project: latexProjectSchema,
  settings: latexProjectSettingsSchema.partial().optional(),
});
export type CreateLatexProjectInput = z.infer<typeof createLatexProjectSchema>;

export const importOverleafTemplateRequestSchema = z.object({
  url: z.url().max(2_000),
});
export type ImportOverleafTemplateRequest = z.infer<
  typeof importOverleafTemplateRequestSchema
>;

export const importOverleafTemplateResponseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  project: latexProjectSchema,
  sourceKind: z.enum(["page", "archive"]),
  missingSupportFiles: z.array(z.string().min(1).max(240)).max(20),
});
export type ImportOverleafTemplateResponse = z.infer<
  typeof importOverleafTemplateResponseSchema
>;

export const importLatexSourceResponseSchema =
  importOverleafTemplateResponseSchema;
export type ImportLatexSourceResponse = z.infer<
  typeof importLatexSourceResponseSchema
>;

export const updateLatexProjectSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(100).optional(),
    project: latexProjectSchema.optional(),
    archived: z.boolean().optional(),
    settings: latexProjectSettingsSchema.partial().optional(),
    conversationId: z
      .string()
      .regex(/^[a-f\d]{24}$/i, "Invalid conversation id")
      .nullable()
      .optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.project !== undefined ||
      value.archived !== undefined ||
      value.settings !== undefined ||
      value.conversationId !== undefined,
    "At least one project field is required",
  );
export type UpdateLatexProjectInput = z.infer<typeof updateLatexProjectSchema>;

export const compileLatexProjectRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  project: latexProjectSchema,
});
export type CompileLatexProjectRequest = z.infer<
  typeof compileLatexProjectRequestSchema
>;

export const compileLatexProjectResponseSchema = z.object({
  project: latexProjectRecordSchema,
  log: z.string(),
});
export type CompileLatexProjectResponse = z.infer<
  typeof compileLatexProjectResponseSchema
>;

export const latexInlineCompletionRequestSchema = z.object({
  revision: z.number().int().nonnegative(),
  filePath: z.string().min(1).max(240),
  cursor: z.number().int().nonnegative(),
  prefix: z.string().max(1_500),
  suffix: z.string().max(1_000),
  paragraph: z.string().max(4_000),
});
export type LatexInlineCompletionRequest = z.infer<
  typeof latexInlineCompletionRequestSchema
>;

export const latexInlineCompletionResponseSchema = z.object({
  completion: z.string().max(1_000),
  latencyMs: z.number().nonnegative(),
  provider: z.literal("hosted"),
});
export type LatexInlineCompletionResponse = z.infer<
  typeof latexInlineCompletionResponseSchema
>;

export const latexMemoryContextResponseSchema = z.object({
  context: z.string().nullable(),
  trust: z.literal("untrusted"),
  traceId: z.string().nullable(),
  estimatedTokens: z.number().int().nonnegative(),
});
export type LatexMemoryContextResponse = z.infer<
  typeof latexMemoryContextResponseSchema
>;
