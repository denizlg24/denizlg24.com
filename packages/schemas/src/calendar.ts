import { z } from "zod";

export const calendarEventSourceSchema = z.object({
  provider: z.enum(["nager-date", "people", "google"]),
  providerKey: z.string(),
  countryCode: z.string().optional(),
  personId: z.string().optional(),
  generatedYear: z.number().optional(),
  isCustomized: z.boolean(),
  isSuppressed: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const calendarEventLinkSchema = z.object({
  _id: z.string(),
  label: z.string(),
  icon: z.string().optional(),
  url: z.string(),
});

export const calendarEventSchema = z.object({
  _id: z.string(),
  date: z.string(),
  endDate: z.string().optional(),
  calendarDate: z.string(),
  isAllDay: z.boolean(),
  kind: z.enum(["manual", "meeting", "flight", "holiday", "birthday"]),
  source: calendarEventSourceSchema.optional(),
  title: z.string(),
  place: z.string().optional(),
  links: z.array(calendarEventLinkSchema),
  status: z.enum(["scheduled", "completed", "canceled"]),
  notifyBySlack: z.boolean(),
  isNotificationSent: z.boolean(),
  notifyBeforeMinutes: z.number(),
  notifyAt: z.string().optional(),
});
export type ICalendarEvent = z.infer<typeof calendarEventSchema>;

export const calendarSettingsSchema = z.object({
  _id: z.literal("singleton"),
  holidayCountryCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ICalendarSettings = z.infer<typeof calendarSettingsSchema>;

export const countryOptionSchema = z.object({
  countryCode: z.string(),
  name: z.string(),
});
export type ICountryOption = z.infer<typeof countryOptionSchema>;

export const calendarExternalProviderSchema = z.literal("google");

export const calendarExternalConnectionSchema = z.object({
  _id: z.string().optional(),
  provider: calendarExternalProviderSchema,
  enabled: z.boolean(),
  calendarId: z.string(),
  accountEmail: z.string().optional(),
  scope: z.array(z.string()),
  connectedAt: z.string(),
  updatedAt: z.string(),
  lastSyncAt: z.string().optional(),
  lastSyncError: z.string().optional(),
});
export type ICalendarExternalConnection = z.infer<
  typeof calendarExternalConnectionSchema
>;

export const calendarExternalSyncSchema = z.object({
  _id: z.string().optional(),
  provider: calendarExternalProviderSchema,
  localEventId: z.string(),
  remoteCalendarId: z.string(),
  remoteEventId: z.string(),
  lastSyncedHash: z.string().optional(),
  lastSyncedAt: z.string().optional(),
  pendingAction: z.enum(["upsert", "delete"]).optional(),
  lastError: z.string().optional(),
  updatedAt: z.string(),
});
export type ICalendarExternalSync = z.infer<typeof calendarExternalSyncSchema>;

export const calendarGoogleIntegrationStatusSchema = z.object({
  connected: z.boolean(),
  enabled: z.boolean(),
  calendarId: z.string(),
  accountEmail: z.string().optional(),
  scope: z.array(z.string()),
  connectedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastSyncAt: z.string().optional(),
  lastSyncError: z.string().optional(),
  needsReauth: z.boolean().optional(),
  pendingSyncCount: z.number(),
  failedSyncCount: z.number(),
});
export type ICalendarGoogleIntegrationStatus = z.infer<
  typeof calendarGoogleIntegrationStatusSchema
>;
