import { z } from "zod";

export const macrosPushEnvironments = ["sandbox", "production"] as const;
export const macrosPushEnvironmentSchema = z.enum(macrosPushEnvironments);

// APNs device tokens are 32 bytes today, sent as hex; Apple reserves the right
// to lengthen them, so only the alphabet and a generous ceiling are enforced.
const apnsTokenSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64,200}$/);

export const macrosRegisterPushDeviceBodySchema = z.object({
  token: apnsTokenSchema,
  environment: macrosPushEnvironmentSchema,
  bundleId: z.string().trim().min(1).max(200),
});

export const macrosUnregisterPushDeviceBodySchema = z.object({
  token: apnsTokenSchema,
});

export const macrosPushDeviceResponseSchema = z.object({
  device: z.object({
    id: z.uuid(),
    environment: macrosPushEnvironmentSchema,
    lastSeenAt: z.string(),
  }),
});

export const macrosNotificationPreferencesSchema = z.object({
  weeklySummary: z.boolean(),
  streakNudge: z.boolean(),
  streakNudgeHour: z.number().int().min(0).max(23),
});

export const macrosUpdateNotificationPreferencesBodySchema =
  macrosNotificationPreferencesSchema
    .partial()
    .refine(
      (body) =>
        body.weeklySummary !== undefined ||
        body.streakNudge !== undefined ||
        body.streakNudgeHour !== undefined,
      { message: "Nothing to update" },
    );

export const macrosNotificationPreferencesResponseSchema = z.object({
  preferences: macrosNotificationPreferencesSchema,
});

export type MacrosPushEnvironment = z.infer<typeof macrosPushEnvironmentSchema>;
export type MacrosRegisterPushDeviceBody = z.infer<
  typeof macrosRegisterPushDeviceBodySchema
>;
export type MacrosUnregisterPushDeviceBody = z.infer<
  typeof macrosUnregisterPushDeviceBodySchema
>;
export type MacrosPushDeviceResponse = z.infer<
  typeof macrosPushDeviceResponseSchema
>;
export type MacrosNotificationPreferences = z.infer<
  typeof macrosNotificationPreferencesSchema
>;
export type MacrosUpdateNotificationPreferencesBody = z.infer<
  typeof macrosUpdateNotificationPreferencesBodySchema
>;
export type MacrosNotificationPreferencesResponse = z.infer<
  typeof macrosNotificationPreferencesResponseSchema
>;
