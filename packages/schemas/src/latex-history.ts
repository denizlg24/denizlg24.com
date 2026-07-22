import { z } from "zod";
import { latexProjectRecordSchema } from "./latex-project";
import { latexProjectSchema } from "./settings";

export const latexProjectHistoryActionSchema = z.enum([
  "create",
  "edit",
  "rename",
  "restore",
]);
export type LatexProjectHistoryAction = z.infer<
  typeof latexProjectHistoryActionSchema
>;

export const latexProjectChangedFileSchema = z.object({
  path: z.string().min(1).max(240),
  status: z.enum(["added", "modified", "deleted"]),
});
export type LatexProjectChangedFile = z.infer<
  typeof latexProjectChangedFileSchema
>;

export const latexProjectHistorySummarySchema = z.object({
  _id: z.string(),
  projectId: z.string(),
  revision: z.number().int().nonnegative(),
  name: z.string().min(1).max(100),
  action: latexProjectHistoryActionSchema,
  compileCount: z.number().int().nonnegative(),
  changedFiles: z.array(latexProjectChangedFileSchema).max(64),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type LatexProjectHistorySummary = z.infer<
  typeof latexProjectHistorySummarySchema
>;

export const latexProjectHistoryDetailSchema =
  latexProjectHistorySummarySchema.extend({
    project: latexProjectSchema,
  });
export type LatexProjectHistoryDetail = z.infer<
  typeof latexProjectHistoryDetailSchema
>;

export const latexProjectHistoryListResponseSchema = z.object({
  revisions: z.array(latexProjectHistorySummarySchema),
});
export type LatexProjectHistoryListResponse = z.infer<
  typeof latexProjectHistoryListResponseSchema
>;

export const latexProjectHistoryDetailResponseSchema = z.object({
  revision: latexProjectHistoryDetailSchema,
});
export type LatexProjectHistoryDetailResponse = z.infer<
  typeof latexProjectHistoryDetailResponseSchema
>;

export const restoreLatexProjectHistorySchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  snapshotId: z.string().min(1).max(100),
});
export type RestoreLatexProjectHistoryInput = z.infer<
  typeof restoreLatexProjectHistorySchema
>;

export const restoreLatexProjectHistoryResponseSchema = z.object({
  project: latexProjectRecordSchema,
});
export type RestoreLatexProjectHistoryResponse = z.infer<
  typeof restoreLatexProjectHistoryResponseSchema
>;
