import { z } from "zod";

export const appSettingsSchema = z.object({
  timeZone: z.string().nullable(),
  effectiveTimeZone: z.string(),
});
export type IAppSettings = z.infer<typeof appSettingsSchema>;

export const appSettingsResponseSchema = z.object({
  settings: appSettingsSchema,
});
export type AppSettingsResponse = z.infer<typeof appSettingsResponseSchema>;

export const cvFileSchema = z.object({
  url: z.string(),
  filename: z.string(),
  size: z.number(),
  updatedAt: z.string(),
});
export type ICvFile = z.infer<typeof cvFileSchema>;

export const cvResponseSchema = z.object({
  cv: cvFileSchema.nullable(),
});
export type CvResponse = z.infer<typeof cvResponseSchema>;
