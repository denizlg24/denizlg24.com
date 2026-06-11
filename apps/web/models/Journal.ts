import mongoose from "mongoose";
import type { ICalendarEvent, ILeanCalendarEvent } from "./CalendarEvent";
import { CalendarEventSchema } from "./CalendarEvent";
import type { ILeanWhiteboard, IWhiteboard } from "./Whiteboard";
import { WhiteboardSchema } from "./Whiteboard";

export interface IJournalLog extends mongoose.Document {
  date: Date;
  content: string;
  whiteboard?: IWhiteboard;
  events: ICalendarEvent[];
  notes: mongoose.Types.ObjectId[];
}

export interface ILeanJournalLog {
  _id: string;
  date: Date;
  content: string;
  whiteboard?: ILeanWhiteboard;
  events: ILeanCalendarEvent[];
  notes: string[];
}

const JournalLogSchema = new mongoose.Schema<IJournalLog>({
  date: { type: Date, required: true, unique: true },
  content: { type: String, default: "" },
  whiteboard: { type: WhiteboardSchema },
  events: [{ type: CalendarEventSchema, default: [] }],
  notes: [{ type: mongoose.Schema.Types.ObjectId, ref: "KnowledgeNote" }],
});

export const JournalLog: mongoose.Model<IJournalLog> =
  mongoose.models.JournalLog ||
  mongoose.model<IJournalLog>("JournalLog", JournalLogSchema);
