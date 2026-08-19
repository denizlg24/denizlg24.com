import { z } from "zod";
import { macrosIsoDateSchema } from "./common";

export const macrosBodyMeasurementSiteSchema = z.enum([
  "waist",
  "hips",
  "chest",
  "neck",
  "left_arm",
  "right_arm",
  "left_thigh",
  "right_thigh",
  "calf",
  "body_fat",
]);
export const macrosBodyMeasurementBodySchema = z.object({
  logDate: macrosIsoDateSchema,
  site: macrosBodyMeasurementSiteSchema,
  value: z.number().positive().max(500),
  unit: z.enum(["cm", "in", "%"]).default("cm"),
});
export const macrosDailyActivityBodySchema = z.object({
  logDate: macrosIsoDateSchema,
  steps: z.number().int().nonnegative().max(200_000).nullable().optional(),
  activeEnergyKcal: z.number().nonnegative().max(10_000).nullable().optional(),
});
export const macrosHydrationBodySchema = z.object({
  logDate: macrosIsoDateSchema,
  volume: z.number().positive().max(10_000),
  unit: z.enum(["ml", "oz"]).default("ml"),
});
export const macrosHabitBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  targetPerWeek: z.number().int().min(1).max(7).default(7),
});
export const macrosHabitCompletionBodySchema = z.object({
  logDate: macrosIsoDateSchema,
  completed: z.boolean(),
});
export const macrosHealthImportSourceSchema = z.enum([
  "apple_shortcuts",
  "health_connect",
  "file",
  "vendor",
]);
export const macrosHealthImportTokenBodySchema = z.object({
  source: macrosHealthImportSourceSchema,
  label: z.string().trim().min(1).max(80),
});
export const macrosHealthImportBodySchema = z.object({
  weighIns: z
    .array(
      z.object({
        logDate: macrosIsoDateSchema,
        weightKg: z.number().positive().max(500),
        bodyFatPct: z.number().positive().max(75).nullable().optional(),
      }),
    )
    .max(366)
    .default([]),
  activity: z
    .array(
      macrosDailyActivityBodySchema.extend({
        sourceId: z.string().trim().max(200).nullable().optional(),
      }),
    )
    .max(366)
    .default([]),
});

export type MacrosBodyMeasurementBody = z.infer<
  typeof macrosBodyMeasurementBodySchema
>;
export type MacrosDailyActivityBody = z.infer<
  typeof macrosDailyActivityBodySchema
>;
export type MacrosHydrationBody = z.infer<typeof macrosHydrationBodySchema>;
export type MacrosHabitBody = z.infer<typeof macrosHabitBodySchema>;
export type MacrosHabitCompletionBody = z.infer<
  typeof macrosHabitCompletionBodySchema
>;
export type MacrosHealthImportBody = z.infer<
  typeof macrosHealthImportBodySchema
>;
