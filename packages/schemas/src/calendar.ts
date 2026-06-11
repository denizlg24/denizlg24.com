import { z } from "zod";

export const calendarEventSourceSchema = z.object({
  provider: z.enum(["nager-date", "people"]),
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
  calendarDate: z.string(),
  isAllDay: z.boolean(),
  kind: z.enum(["manual", "holiday", "birthday"]),
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
