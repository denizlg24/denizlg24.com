import { z } from "zod";
import { macrosActiveGoalSchema, macrosGoalHistoryEntrySchema } from "./goals";
import { macrosPlanDetailSchema } from "./plans";

export const macrosStrategyResponseSchema = z.object({
  plan: macrosPlanDetailSchema.nullable(),
  goal: macrosActiveGoalSchema.nullable(),
  history: z.array(macrosGoalHistoryEntrySchema),
});

export type MacrosStrategyResponse = z.infer<
  typeof macrosStrategyResponseSchema
>;
