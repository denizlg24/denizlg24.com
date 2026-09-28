import { z } from "zod";
import {
  macrosDailyMacrosSchema,
  macrosIsoDateSchema,
  macrosMealTypeSchema,
} from "./common";

export const macrosFavoriteFoodBodySchema = z.object({
  sourceItemId: z.uuid(),
  defaultServings: z.number().positive().max(9999).default(1),
});
// Each copy keeps its source's time of day on the target date. Absent
// `entryIds` copies the whole source day.
export const macrosCopyLogBodySchema = z.object({
  sourceDate: macrosIsoDateSchema,
  targetDate: macrosIsoDateSchema,
  entryIds: z.array(z.uuid()).min(1).max(100).optional(),
});
export const macrosCreateMealTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  entryIds: z.array(z.uuid()).min(1).max(100),
});
export const macrosLogMealTemplateBodySchema = z.object({
  templateId: z.uuid(),
  logDate: macrosIsoDateSchema.optional(),
  // Every item lands at this instant; absent means now.
  eatenAt: z.iso.datetime({ offset: true }).optional(),
  clientMutationId: z.uuid().optional(),
});
export const macrosMoveEntriesBodySchema = z
  .object({
    entryIds: z.array(z.uuid()).min(1).max(100),
    // Absent keeps each entry on its day, or on the day of `eatenAt`.
    logDate: macrosIsoDateSchema.optional(),
    // Sets every entry to this instant. Absent keeps each entry's own time of
    // day, which is what makes a pure date move leave the ordering alone.
    eatenAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((body) => body.logDate !== undefined || body.eatenAt !== undefined, {
    message: "Move to a day, a time, or both",
  });
export const macrosBulkDeleteEntriesBodySchema = z.object({
  entryIds: z.array(z.uuid()).min(1).max(100),
});
// The measure the owner typed, kept alongside the serving multiplier so the
// log can say "150 g" rather than "1.5 servings" when grams were entered.
export const macrosEnteredUnitSchema = z.enum(["g", "oz", "lb", "serving"]);

export const macrosEnteredMeasureSchema = z.object({
  enteredQuantity: z.number().positive().max(999999).optional(),
  enteredUnit: macrosEnteredUnitSchema.optional(),
});

export const macrosUpdateLogEntryBodySchema = z
  .object({
    // Absent leaves the serving alone, and with it the nutrients derived from
    // it - which is what lets a pure retime avoid rescaling anything.
    servingsConsumed: z.number().positive().max(9999).optional(),
    // Absent leaves the stored note alone; an empty string clears it.
    notes: z.string().trim().max(500).optional(),
    // Absent leaves the entry where it sits in the day's order.
    eatenAt: z.iso.datetime({ offset: true }).optional(),
    // Absent keeps the entry's day. Without `eatenAt`, a new day carries the
    // entry's time of day across.
    logDate: macrosIsoDateSchema.optional(),
  })
  .extend(macrosEnteredMeasureSchema.shape)
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export type MacrosEnteredUnit = z.infer<typeof macrosEnteredUnitSchema>;
export type MacrosEnteredMeasure = z.infer<typeof macrosEnteredMeasureSchema>;
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

export const macrosMealTemplateSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  name: z.string(),
  defaultMealType: macrosMealTypeSchema.nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const macrosMealTemplateListItemSchema = macrosMealTemplateSchema.extend(
  { itemCount: z.number().int().nonnegative() },
);
export const macrosMealTemplatesResponseSchema = z.object({
  items: z.array(macrosMealTemplateListItemSchema),
});
export const macrosCreateMealTemplateResponseSchema = z.object({
  template: macrosMealTemplateSchema,
});
export const macrosLogMealTemplateResponseSchema = z.object({
  entryIds: z.array(z.uuid()),
  logDate: z.string(),
  totals: macrosDailyMacrosSchema,
});

export type MacrosMealTemplate = z.infer<typeof macrosMealTemplateSchema>;
export type MacrosMealTemplateListItem = z.infer<
  typeof macrosMealTemplateListItemSchema
>;
export type MacrosMealTemplatesResponse = z.infer<
  typeof macrosMealTemplatesResponseSchema
>;
export type MacrosCreateMealTemplateResponse = z.infer<
  typeof macrosCreateMealTemplateResponseSchema
>;
export type MacrosLogMealTemplateResponse = z.infer<
  typeof macrosLogMealTemplateResponseSchema
>;
