import { z } from "zod";

export const TIMETABLE_COLORS = [
  "background",
  "surface",
  "muted",
  "accent",
  "accent-strong",
  "foreground",
  "destructive",
] as const;

export const timetableColorSchema = z.enum(TIMETABLE_COLORS);
export type TimetableColor = z.infer<typeof timetableColorSchema>;

export const timetableEntryLinkSchema = z.object({
  _id: z.string(),
  label: z.string(),
  url: z.string(),
  icon: z.string().optional(),
});

export const timetableEntrySchema = z.object({
  _id: z.string(),
  title: z.string(),
  dayOfWeek: z.number(),
  startTime: z.string(),
  endTime: z.string(),
  place: z.string().optional(),
  links: z.array(timetableEntryLinkSchema),
  color: timetableColorSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ITimetableEntry = z.infer<typeof timetableEntrySchema>;
