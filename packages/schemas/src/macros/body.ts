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

export const macrosActivitySourceSchema = z.enum(["manual", "import"]);

// Rows echoed by the write routes carry Postgres numerics as strings; the
// overview converts them to numbers. The two shapes are kept apart on purpose.
export const macrosBodyMeasurementRowSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  logDate: z.string(),
  site: macrosBodyMeasurementSiteSchema,
  value: z.string(),
  unit: z.string(),
  source: macrosActivitySourceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const macrosDailyActivityRowSchema = z.object({
  userId: z.string(),
  logDate: z.string(),
  steps: z.number().nullable(),
  activeEnergyKcal: z.string().nullable(),
  source: macrosActivitySourceSchema,
  sourceId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const macrosHydrationRowSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  logDate: z.string(),
  volume: z.string(),
  unit: z.string(),
  loggedAt: z.string(),
  source: macrosActivitySourceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const macrosHabitSchema = z.object({
  id: z.uuid(),
  userId: z.string(),
  name: z.string(),
  targetPerWeek: z.number(),
  isBuiltin: z.boolean(),
  builtinKey: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const macrosBodyOverviewSchema = z.object({
  today: z.string(),
  measurements: z.array(
    macrosBodyMeasurementRowSchema.extend({ value: z.number() }),
  ),
  activity: z.array(
    macrosDailyActivityRowSchema.extend({
      activeEnergyKcal: z.number().nullable(),
    }),
  ),
  hydration: z.array(z.object({ logDate: z.string(), volumeMl: z.number() })),
  habits: z.array(
    macrosHabitSchema.extend({ completedDates: z.array(z.string()) }),
  ),
});
export const macrosBodyOverviewResponseSchema = z.object({
  overview: macrosBodyOverviewSchema,
});
export const macrosBodyMeasurementResponseSchema = z.object({
  measurement: macrosBodyMeasurementRowSchema,
});
export const macrosHydrationResponseSchema = z.object({
  hydration: macrosHydrationRowSchema,
});
export const macrosDailyActivityResponseSchema = z.object({
  activity: macrosDailyActivityRowSchema,
});
export const macrosHabitResponseSchema = z.object({ habit: macrosHabitSchema });
export const macrosHabitCompletionResponseSchema = z.object({
  updated: z.literal(true),
});

export const macrosBodyPhotoAngleSchema = z.enum([
  "front",
  "left",
  "right",
  "back",
  "other",
]);
export const macrosBodyPhotosQuerySchema = z.object({
  angle: macrosBodyPhotoAngleSchema.optional(),
});
export const macrosBodyPhotoUploadBodySchema = z.object({
  angle: macrosBodyPhotoAngleSchema,
  mimeType: z.literal("image/jpeg"),
});
export const macrosBodyPhotoCompleteBodySchema = z.object({
  storageKey: z.string().min(1),
  angle: macrosBodyPhotoAngleSchema,
  width: z.number().int().positive().max(5000),
  height: z.number().int().positive().max(5000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: z.string().datetime().optional(),
});
export const macrosBodyPhotoListItemSchema = z.object({
  id: z.uuid(),
  angle: macrosBodyPhotoAngleSchema,
  storageKey: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  capturedAt: z.string().nullable(),
  logDate: z.string(),
  weightKg: z.number(),
  url: z.string(),
});
export const macrosBodyPhotosResponseSchema = z.object({
  photos: z.array(macrosBodyPhotoListItemSchema),
});
export const macrosBodyPhotoUploadResponseSchema = z.object({
  uploadUrl: z.string(),
  storageKey: z.string(),
  weighInId: z.uuid(),
});
export const macrosBodyPhotoSchema = z.object({
  id: z.uuid(),
  weighInId: z.uuid(),
  userId: z.string(),
  angle: macrosBodyPhotoAngleSchema,
  objectUrl: z.string(),
  storageKey: z.string(),
  mimeType: z.string().nullable(),
  byteSize: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  sha256: z.string().nullable(),
  capturedAt: z.string().nullable(),
  uploadedAt: z.string(),
});
export const macrosBodyPhotoCompleteResponseSchema = z.object({
  photo: macrosBodyPhotoSchema,
});

export const macrosHealthImportTokenSchema = z.object({
  id: z.uuid(),
  source: macrosHealthImportSourceSchema,
  token: z.string(),
});
export const macrosHealthImportTokenResponseSchema = z.object({
  token: macrosHealthImportTokenSchema,
});

export type MacrosHealthImportSource = z.infer<
  typeof macrosHealthImportSourceSchema
>;
export type MacrosHealthImportTokenBody = z.infer<
  typeof macrosHealthImportTokenBodySchema
>;
export type MacrosBodyMeasurementSite = z.infer<
  typeof macrosBodyMeasurementSiteSchema
>;
export type MacrosActivitySource = z.infer<typeof macrosActivitySourceSchema>;
export type MacrosBodyMeasurementRow = z.infer<
  typeof macrosBodyMeasurementRowSchema
>;
export type MacrosDailyActivityRow = z.infer<
  typeof macrosDailyActivityRowSchema
>;
export type MacrosHydrationRow = z.infer<typeof macrosHydrationRowSchema>;
export type MacrosHabit = z.infer<typeof macrosHabitSchema>;
export type MacrosBodyOverview = z.infer<typeof macrosBodyOverviewSchema>;
export type MacrosBodyOverviewResponse = z.infer<
  typeof macrosBodyOverviewResponseSchema
>;
export type MacrosBodyMeasurementResponse = z.infer<
  typeof macrosBodyMeasurementResponseSchema
>;
export type MacrosHydrationResponse = z.infer<
  typeof macrosHydrationResponseSchema
>;
export type MacrosDailyActivityResponse = z.infer<
  typeof macrosDailyActivityResponseSchema
>;
export type MacrosHabitResponse = z.infer<typeof macrosHabitResponseSchema>;
export type MacrosHabitCompletionResponse = z.infer<
  typeof macrosHabitCompletionResponseSchema
>;
export type MacrosBodyPhotoAngle = z.infer<typeof macrosBodyPhotoAngleSchema>;
export type MacrosBodyPhotosQuery = z.infer<typeof macrosBodyPhotosQuerySchema>;
export type MacrosBodyPhotoUploadBody = z.infer<
  typeof macrosBodyPhotoUploadBodySchema
>;
export type MacrosBodyPhotoCompleteBody = z.infer<
  typeof macrosBodyPhotoCompleteBodySchema
>;
export type MacrosBodyPhotoListItem = z.infer<
  typeof macrosBodyPhotoListItemSchema
>;
export type MacrosBodyPhotosResponse = z.infer<
  typeof macrosBodyPhotosResponseSchema
>;
export type MacrosBodyPhotoUploadResponse = z.infer<
  typeof macrosBodyPhotoUploadResponseSchema
>;
export type MacrosBodyPhoto = z.infer<typeof macrosBodyPhotoSchema>;
export type MacrosBodyPhotoCompleteResponse = z.infer<
  typeof macrosBodyPhotoCompleteResponseSchema
>;
export type MacrosHealthImportToken = z.infer<
  typeof macrosHealthImportTokenSchema
>;
export type MacrosHealthImportTokenResponse = z.infer<
  typeof macrosHealthImportTokenResponseSchema
>;
