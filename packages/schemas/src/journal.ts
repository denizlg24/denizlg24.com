import { z } from "zod";
import { calendarEventSchema } from "./calendar";
import { whiteboardSchema } from "./whiteboard";

export const journalLogSchema = z.object({
  _id: z.string(),
  date: z.date(),
  content: z.string(),
  whiteboard: whiteboardSchema.optional(),
  events: z.array(calendarEventSchema),
  notes: z.array(z.string()),
});
export type IJournalLog = z.infer<typeof journalLogSchema>;
