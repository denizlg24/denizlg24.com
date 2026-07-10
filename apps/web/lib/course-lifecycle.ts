import type mongoose from "mongoose";
import { Course } from "@/models/Course";
import { TimetableEntry } from "@/models/TimetableEntry";
import { connectDB } from "./mongodb";
import { getAppTimeZone, inTz } from "./timezone";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
let lastSyncAt = 0;

function startOfDay(date: Date, timeZone: string): Date {
  const result = inTz(date, timeZone);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date, timeZone: string): Date {
  const result = inTz(date, timeZone);
  result.setHours(23, 59, 59, 999);
  return result;
}

type CoursePhase = "pending" | "running" | "ended";

function coursePhase(
  startsOn: Date | undefined | null,
  endsOn: Date | undefined | null,
  now: Date,
  timeZone: string,
): CoursePhase {
  if (endsOn && now > endOfDay(endsOn, timeZone)) return "ended";
  if (startsOn && now < startOfDay(startsOn, timeZone)) return "pending";
  return "running";
}

export interface CourseScheduleSyncResult {
  activated: number;
  deactivated: number;
  deleted: number;
}

/**
 * Aligns course-linked timetable entries with each course's date range:
 * entries stay archived until the course starts, become active while it
 * runs, and are deleted once it ends. Entries shared between courses take
 * the most permissive phase (running > pending > ended).
 */
export async function syncCourseSchedules(
  now = new Date(),
): Promise<CourseScheduleSyncResult> {
  await connectDB();

  const courses = await Course.find({
    "timetableEntryIds.0": { $exists: true },
    $or: [{ startsOn: { $type: "date" } }, { endsOn: { $type: "date" } }],
  })
    .select("timetableEntryIds startsOn endsOn")
    .lean();

  const timeZone = await getAppTimeZone();
  const phaseByEntry = new Map<string, CoursePhase>();
  const endedCourseIds: mongoose.Types.ObjectId[] = [];

  for (const course of courses) {
    const phase = coursePhase(course.startsOn, course.endsOn, now, timeZone);
    if (phase === "ended") endedCourseIds.push(course._id);
    for (const entryId of course.timetableEntryIds ?? []) {
      const key = String(entryId);
      const current = phaseByEntry.get(key);
      if (
        !current ||
        phase === "running" ||
        (phase === "pending" && current === "ended")
      ) {
        phaseByEntry.set(key, phase);
      }
    }
  }

  const toActivate: string[] = [];
  const toDeactivate: string[] = [];
  const toDelete: string[] = [];
  for (const [entryId, phase] of phaseByEntry) {
    if (phase === "running") toActivate.push(entryId);
    else if (phase === "pending") toDeactivate.push(entryId);
    else toDelete.push(entryId);
  }

  const result: CourseScheduleSyncResult = {
    activated: 0,
    deactivated: 0,
    deleted: 0,
  };

  if (toActivate.length > 0) {
    const updated = await TimetableEntry.updateMany(
      { _id: { $in: toActivate }, isActive: false },
      { isActive: true },
    );
    result.activated = updated.modifiedCount;
  }

  if (toDeactivate.length > 0) {
    const updated = await TimetableEntry.updateMany(
      { _id: { $in: toDeactivate }, isActive: true },
      { isActive: false },
    );
    result.deactivated = updated.modifiedCount;
  }

  if (toDelete.length > 0) {
    const deleted = await TimetableEntry.deleteMany({
      _id: { $in: toDelete },
    });
    result.deleted = deleted.deletedCount;
    await Course.updateMany(
      { _id: { $in: endedCourseIds } },
      { $pull: { timetableEntryIds: { $in: toDelete } } },
    );
  }

  return result;
}

/**
 * Throttled wrapper for read paths: runs the sync at most once per
 * interval per server instance and never lets a sync failure break the
 * request that triggered it.
 */
export async function maybeSyncCourseSchedules(): Promise<void> {
  const now = Date.now();
  if (now - lastSyncAt < SYNC_INTERVAL_MS) return;
  lastSyncAt = now;
  try {
    await syncCourseSchedules();
  } catch (error) {
    console.error("Course schedule sync failed:", error);
  }
}
