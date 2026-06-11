import { connectDB } from "@/lib/mongodb";
import {
  type ILeanTimetableEntry,
  type ITimetableEntry,
  TimetableEntry,
} from "@/models/TimetableEntry";

function serializeEntry(
  entry: ITimetableEntry & { _id: unknown },
): ILeanTimetableEntry {
  return {
    ...entry,
    _id: String(entry._id),
    links: (entry.links || []).map((link) => ({
      ...link,
      _id: String(link._id),
    })),
  };
}

export async function getAllTimetableEntries(): Promise<ILeanTimetableEntry[]> {
  await connectDB();
  const entries = await TimetableEntry.find()
    .sort({ dayOfWeek: 1, startTime: 1 })
    .lean();
  return entries.map(serializeEntry);
}

export async function getTimetableEntryById(
  id: string,
): Promise<ILeanTimetableEntry | null> {
  await connectDB();
  const entry = await TimetableEntry.findById(id).lean();
  if (!entry) return null;
  return serializeEntry(entry);
}

export async function createTimetableEntry(
  data: Omit<ILeanTimetableEntry, "_id" | "createdAt" | "updatedAt">,
): Promise<ILeanTimetableEntry | null> {
  try {
    await connectDB();
    const entry = await TimetableEntry.create(data);
    return serializeEntry(entry.toObject());
  } catch (err) {
    console.error("Error creating timetable entry:", err);
    return null;
  }
}

export async function updateTimetableEntry(
  id: string,
  data: Partial<ILeanTimetableEntry>,
): Promise<ILeanTimetableEntry | null> {
  try {
    await connectDB();
    const entry = await TimetableEntry.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    }).lean();
    if (!entry) return null;
    return serializeEntry(entry);
  } catch (err) {
    console.error("Error updating timetable entry:", err);
    return null;
  }
}

export async function deleteTimetableEntry(id: string): Promise<boolean> {
  try {
    await connectDB();
    await TimetableEntry.findByIdAndDelete(id);
    return true;
  } catch (err) {
    console.error("Error deleting timetable entry:", err);
    return false;
  }
}
