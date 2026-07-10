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
