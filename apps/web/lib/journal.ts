import { endOfDay, startOfDay } from "date-fns";
import type mongoose from "mongoose";
import { CalendarEvent } from "@/models/CalendarEvent";
import type { IJournalLog, ILeanJournalLog } from "@/models/Journal";
import { JournalLog } from "@/models/Journal";
import { Note } from "@/models/Note";
import type { IWhiteboard } from "@/models/Whiteboard";
import { Whiteboard } from "@/models/Whiteboard";
import { connectDB } from "./mongodb";

function serializeJournal(journal: IJournalLog): ILeanJournalLog {
  return {
    _id: journal._id.toString(),
    date: journal.date,
    content: journal.content,
    whiteboard: journal.whiteboard
      ? {
          _id: String(journal.whiteboard._id),
          name: journal.whiteboard.name,
          elements: journal.whiteboard.elements,
          viewState: journal.whiteboard.viewState,
          order: journal.whiteboard.order,
          createdAt: journal.whiteboard.createdAt,
          updatedAt: journal.whiteboard.updatedAt,
        }
      : undefined,
    events: (journal.events ?? []).map((event) => ({
      _id: String(event._id),
      date: event.date,
      calendarDate:
        event.calendarDate ?? new Date(event.date).toISOString().slice(0, 10),
      isAllDay: event.isAllDay ?? false,
      kind: event.kind ?? "manual",
      source: event.source
        ? {
            ...event.source,
            personId: event.source.personId
              ? String(event.source.personId)
              : undefined,
            isCustomized: event.source.isCustomized ?? false,
            isSuppressed: event.source.isSuppressed ?? false,
          }
        : undefined,
      title: event.title,
      place: event.place,
      links: (event.links ?? []).map((link) => ({
        _id: String(link._id),
        label: link.label,
        icon: link.icon,
        url: link.url,
      })),
      status: event.status,
      notifyBySlack: event.notifyBySlack,
      isNotificationSent: event.isNotificationSent,
      notifyBeforeMinutes: event.notifyBeforeMinutes,
      notifyAt: event.notifyAt,
    })),
    notes: (journal.notes ?? []).map((id) => id.toString()),
  };
}

export async function getJournalLogs(
  startDate?: Date,
  endDate?: Date,
): Promise<ILeanJournalLog[]> {
  try {
    await connectDB();
    const filter: Record<string, unknown> = {};
    if (startDate || endDate) {
      filter.date = {
        ...(startDate && { $gte: startOfDay(startDate) }),
        ...(endDate && { $lte: endOfDay(endDate) }),
      };
    }
    const journals = await JournalLog.find(filter).sort({ date: -1 });
    return journals.map(serializeJournal);
  } catch {
    return [];
  }
}

export async function getJournalById(
  id: string,
): Promise<ILeanJournalLog | null> {
  try {
    await connectDB();
    const journal = await JournalLog.findById(id);
    if (!journal) return null;
    return serializeJournal(journal);
  } catch {
    return null;
  }
}

export async function getJournalByDate(
  date: Date,
): Promise<ILeanJournalLog | null> {
  try {
    await connectDB();
    const journal = await JournalLog.findOne({
      date: { $gte: startOfDay(date), $lte: endOfDay(date) },
    });
    if (!journal) return null;
    return serializeJournal(journal);
  } catch {
    return null;
  }
}

export async function createJournal(data: {
  date: Date;
  content?: string;
}): Promise<ILeanJournalLog | null> {
  try {
    await connectDB();
    const normalized = startOfDay(data.date);
    const existing = await JournalLog.findOne({
      date: normalized,
    });
    if (existing) return serializeJournal(existing);

    const journal = await JournalLog.create({
      date: normalized,
      content: data.content ?? "",
      events: [],
      notes: [],
    });
    return serializeJournal(journal);
  } catch (err) {
    console.error("Failed to create journal:", err);
    return null;
  }
}

export async function updateJournalContent(
  id: string,
  content: string,
): Promise<ILeanJournalLog | null> {
  try {
    await connectDB();
    const updated = await JournalLog.findByIdAndUpdate(
      id,
      { content },
      { new: true },
    );
    if (!updated) return null;
    return serializeJournal(updated);
  } catch (err) {
    console.error("Failed to update journal:", err);
    return null;
  }
}

export async function deleteJournal(id: string): Promise<boolean> {
  try {
    await connectDB();
    await JournalLog.findByIdAndDelete(id);
    return true;
  } catch {
    return false;
  }
}

interface JournalDayData {
  whiteboard?: IWhiteboard;
  events?: {
    date: Date;
    title: string;
    place?: string;
    links: { label: string; url: string; icon?: string }[];
    status: "scheduled" | "completed" | "canceled";
    notifyBySlack: boolean;
    isNotificationSent: boolean;
    notifyBeforeMinutes: number;
    notifyAt?: Date;
  }[];
  notes?: mongoose.Types.ObjectId[];
}

export async function upsertJournalDayData(
  date: Date,
  data: JournalDayData,
): Promise<ILeanJournalLog | null> {
  try {
    await connectDB();
    const normalized = startOfDay(date);
    const existing = await JournalLog.findOne({
      date: normalized,
    });

    if (existing) {
      const update: Record<string, unknown> = {};
      if (data.whiteboard) update.whiteboard = data.whiteboard;
      if (data.events) update.events = data.events;
      if (data.notes) update.notes = data.notes;

      const updated = await JournalLog.findByIdAndUpdate(existing._id, update, {
        new: true,
      });
      if (!updated) return null;
      return serializeJournal(updated);
    }

    const journal = await JournalLog.create({
      date: normalized,
      content: "",
      whiteboard: data.whiteboard,
      events: data.events ?? [],
      notes: data.notes ?? [],
    });
    return serializeJournal(journal);
  } catch (err) {
    console.error("Failed to upsert journal day data:", err);
    return null;
  }
}

export async function collectDayDataToJournal(
  date: Date,
  options?: { includeWhiteboard?: boolean },
): Promise<ILeanJournalLog | null> {
  try {
    await connectDB();
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);

    const [events, notes, todayBoard] = await Promise.all([
      CalendarEvent.find({
        $or: [
          { "source.isSuppressed": { $ne: true } },
          { source: { $exists: false } },
        ],
        date: { $gte: dayStart, $lte: dayEnd },
        status: { $ne: "canceled" },
      }).lean(),
      Note.find({
        createdAt: { $gte: dayStart, $lte: dayEnd },
      })
        .select("_id")
        .lean(),
      options?.includeWhiteboard
        ? Whiteboard.findOne({ name: "Today" }).lean()
        : null,
    ]);

    const noteIds = notes.map((note) => note._id);

    const data: JournalDayData = {
      events: events.length > 0 ? events : undefined,
      notes: noteIds.length > 0 ? noteIds : undefined,
    };

    if (
      options?.includeWhiteboard &&
      todayBoard &&
      todayBoard.elements.length > 0
    ) {
      data.whiteboard = todayBoard;
    }

    return await upsertJournalDayData(date, data);
  } catch (err) {
    console.error("Failed to collect day data to journal:", err);
    return null;
  }
}
