import { z } from "zod";
import { macrosIsoDateSchema, macrosMealTypeSchema } from "./common";

export const macrosFavoriteFoodBodySchema = z.object({
  sourceItemId: z.uuid(),
  defaultServings: z.number().positive().max(9999).default(1),
  defaultMealType: macrosMealTypeSchema.optional(),
});
export const macrosCopyLogBodySchema = z.object({
  sourceDate: macrosIsoDateSchema,
  targetDate: macrosIsoDateSchema,
  sourceMealType: macrosMealTypeSchema.optional(),
  targetMealType: macrosMealTypeSchema.optional(),
});
export const macrosCreateMealTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  entryIds: z.array(z.uuid()).min(1).max(100),
  defaultMealType: macrosMealTypeSchema.optional(),
});
export const macrosLogMealTemplateBodySchema = z.object({
  templateId: z.uuid(),
  logDate: macrosIsoDateSchema.optional(),
  mealType: macrosMealTypeSchema.optional(),
  clientMutationId: z.uuid().optional(),
});
export const macrosMoveEntriesBodySchema = z.object({
  entryIds: z.array(z.uuid()).min(1).max(100),
  logDate: macrosIsoDateSchema.optional(),
  mealType: macrosMealTypeSchema.optional(),
});
export const macrosBulkDeleteEntriesBodySchema = z.object({
  entryIds: z.array(z.uuid()).min(1).max(100),
});
export const macrosUpdateLogEntryBodySchema = z.object({
  servingsConsumed: z.number().positive().max(9999),
});

export type MacrosFavoriteFoodBody = z.infer<
  typeof macrosFavoriteFoodBodySchema
>;
export type MacrosCopyLogBody = z.infer<typeof macrosCopyLogBodySchema>;
export type MacrosCreateMealTemplateBody = z.infer<
  typeof macrosCreateMealTemplateBodySchema
>;
export type MacrosLogMealTemplateBody = z.infer<
  typeof macrosLogMealTemplateBodySchema
>;
export type MacrosMoveEntriesBody = z.infer<typeof macrosMoveEntriesBodySchema>;
export type MacrosUpdateLogEntryBody = z.infer<
  typeof macrosUpdateLogEntryBodySchema
>;
