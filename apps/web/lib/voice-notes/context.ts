import { TZDate } from "@date-fns/tz";
import type {
  VoiceNoteContext,
  VoiceNoteContextCandidate,
  VoiceNoteContextKind,
} from "@repo/schemas";
import mongoose from "mongoose";
import { visibleCalendarFilter } from "@/lib/calendar-events";
import { connectDB } from "@/lib/mongodb";
import { dateKeyInTz, getAppTimeZone } from "@/lib/timezone";
import { CalendarEvent, type ILeanCalendarEvent } from "@/models/CalendarEvent";
import {
  type ILeanTimetableEntry,
  TimetableEntry,
} from "@/models/TimetableEntry";
import {
  type ILeanVoiceNote,
  type IVoiceNoteContextRef,
  VoiceNote,
} from "@/models/VoiceNote";

/** A recording with no known length still occupies the minute it started in. */
const MIN_WINDOW_MS = 60_000;
/** Events stored without an end are treated as an hour long. */
const OPEN_ENDED_EVENT_MS = 60 * 60_000;
const MIN_OVERLAP_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

interface Interval {
  start: number;
  end: number;
}

type EventRow = Pick<
  ILeanCalendarEvent,
  "_id" | "title" | "date" | "endDate" | "place"
>;
type TimetableRow = Pick<
  ILeanTimetableEntry,
  "_id" | "title" | "dayOfWeek" | "startTime" | "endTime" | "place" | "color"
>;

export function recordedAtOf(voiceNote: ILeanVoiceNote): Date {
  return new Date(voiceNote.recordedAt ?? voiceNote.createdAt);
}

function recordingWindow(recordedAt: Date, durationMs?: number): Interval {
  const start = recordedAt.getTime();
  return { start, end: start + Math.max(durationMs ?? 0, MIN_WINDOW_MS) };
}

function overlap(window: Interval, other: Interval) {
  return Math.max(
    0,
    Math.min(window.end, other.end) - Math.max(window.start, other.start),
  );
}

/**
 * Enough to say the recording happened during it: ten minutes, or half the
 * recording when that is shorter. A lecture recording that runs a minute into
 * the next slot does not belong to the next slot.
 */
function qualifies(window: Interval, overlapMs: number) {
  return (
    overlapMs > 0 &&
    overlapMs >= Math.min(MIN_OVERLAP_MS, (window.end - window.start) / 2)
  );
}

function eventInterval(event: EventRow): Interval {
  const start = new Date(event.date).getTime();
  const end = event.endDate
    ? new Date(event.endDate).getTime()
    : start + OPEN_ENDED_EVENT_MS;
  return { start, end: Math.max(end, start) };
}

function parseClock(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function localDate(dateKey: string, timeZone: string, hours = 0, minutes = 0) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new TZDate(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    hours,
    minutes,
    0,
    0,
    timeZone,
  );
}

/** Timetable entries count 0 = Monday … 6 = Sunday. */
function timetableDay(dateKey: string, timeZone: string) {
  return (localDate(dateKey, timeZone, 12).getDay() + 6) % 7;
}

/** A weekly timetable slot pinned to one calendar day. */
function timetableOccurrence(
  entry: TimetableRow,
  dateKey: string,
  timeZone: string,
): Interval | null {
  const start = parseClock(entry.startTime);
  const end = parseClock(entry.endTime);
  if (!start || !end) return null;
  const startsAt = localDate(dateKey, timeZone, start.hours, start.minutes);
  const endsAt = localDate(dateKey, timeZone, end.hours, end.minutes);
  if (endsAt.getTime() <= startsAt.getTime()) return null;
  return { start: startsAt.getTime(), end: endsAt.getTime() };
}

function byOverlapThenStart(
  a: VoiceNoteContextCandidate,
  b: VoiceNoteContextCandidate,
) {
  return b.overlapMs - a.overlapMs || a.start.localeCompare(b.start);
}

/**
 * Everything the recording could belong to on the local day(s) it spans:
 * timed calendar events and active timetable slots, most-overlapping first.
 */
export async function listContextCandidates(
  recordedAt: Date,
  durationMs?: number,
): Promise<{
  events: VoiceNoteContextCandidate[];
  timetableEntries: VoiceNoteContextCandidate[];
}> {
  await connectDB();
  const timeZone = await getAppTimeZone();
  const window = recordingWindow(recordedAt, durationMs);
  const dateKeys = [
    ...new Set([
      dateKeyInTz(window.start, timeZone),
      dateKeyInTz(window.end, timeZone),
    ]),
  ];
  const dayStart = localDate(dateKeys[0] ?? "", timeZone).getTime();
  const dayEnd = localDate(dateKeys.at(-1) ?? "", timeZone).getTime() + DAY_MS;

  const [events, entries] = await Promise.all([
    CalendarEvent.find({
      $and: [
        visibleCalendarFilter(),
        { isAllDay: { $ne: true } },
        { status: { $ne: "canceled" } },
        { date: { $gte: new Date(dayStart - DAY_MS), $lt: new Date(dayEnd) } },
      ],
    })
      .select("title date endDate place")
      .lean<EventRow[]>()
      .exec(),
    TimetableEntry.find({
      isActive: true,
      dayOfWeek: {
        $in: dateKeys.map((dateKey) => timetableDay(dateKey, timeZone)),
      },
    })
      .select("title dayOfWeek startTime endTime place color")
      .lean<TimetableRow[]>()
      .exec(),
  ]);

  const eventCandidates = events
    .map((event) => ({ event, interval: eventInterval(event) }))
    .filter(
      ({ interval }) => interval.end > dayStart && interval.start < dayEnd,
    )
    .map(
      ({ event, interval }): VoiceNoteContextCandidate => ({
        kind: "calendar-event",
        id: String(event._id),
        title: event.title,
        start: new Date(interval.start).toISOString(),
        end: new Date(interval.end).toISOString(),
        place: event.place || undefined,
        overlapMs: overlap(window, interval),
      }),
    )
    .sort(byOverlapThenStart);

  const timetableCandidates = dateKeys
    .flatMap((dateKey) =>
      entries
        .filter((entry) => entry.dayOfWeek === timetableDay(dateKey, timeZone))
        .map((entry) => ({
          entry,
          interval: timetableOccurrence(entry, dateKey, timeZone),
        })),
    )
    .flatMap(({ entry, interval }): VoiceNoteContextCandidate[] =>
      interval
        ? [
            {
              kind: "timetable-entry",
              id: String(entry._id),
              title: entry.title,
              start: new Date(interval.start).toISOString(),
              end: new Date(interval.end).toISOString(),
              place: entry.place || undefined,
              color: entry.color,
              overlapMs: overlap(window, interval),
            },
          ]
        : [],
    )
    .sort(byOverlapThenStart);

  return { events: eventCandidates, timetableEntries: timetableCandidates };
}

/** A timed calendar event wins over the timetable; the timetable is the fallback. */
export async function deriveContext(
  recordedAt: Date,
  durationMs?: number,
): Promise<IVoiceNoteContextRef | null> {
  const window = recordingWindow(recordedAt, durationMs);
  const { events, timetableEntries } = await listContextCandidates(
    recordedAt,
    durationMs,
  );
  const chosen =
    events.find((candidate) => qualifies(window, candidate.overlapMs)) ??
    timetableEntries.find((candidate) =>
      qualifies(window, candidate.overlapMs),
    );
  return chosen
    ? { kind: chosen.kind, id: new mongoose.Types.ObjectId(chosen.id) }
    : null;
}

/**
 * Re-derives the link unless the owner set or cleared it by hand. Callers
 * decide whether `recordedAt` means anything: for an upload that never said
 * when it was recorded it is only the upload time.
 */
export async function applyDerivedContext(
  voiceNote: ILeanVoiceNote,
): Promise<ILeanVoiceNote> {
  if (voiceNote.contextSource === "manual" || !voiceNote.recordedAt) {
    return voiceNote;
  }
  const context = await deriveContext(
    new Date(voiceNote.recordedAt),
    voiceNote.durationMs,
  );
  const updated = await VoiceNote.findOneAndUpdate(
    { _id: voiceNote._id, contextSource: { $ne: "manual" } },
    context
      ? { $set: { context, contextSource: "auto" } }
      : { $set: { contextSource: "auto" }, $unset: { context: "" } },
    { returnDocument: "after" },
  )
    .lean<ILeanVoiceNote>()
    .exec();
  return updated ?? voiceNote;
}

export async function contextTargetExists(
  kind: VoiceNoteContextKind,
  id: string,
): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  await connectDB();
  const found =
    kind === "calendar-event"
      ? await CalendarEvent.exists({ _id: id }).exec()
      : await TimetableEntry.exists({ _id: id }).exec();
  return Boolean(found);
}

/**
 * Titles and times for the contexts a page of notes points at, in two
 * queries. A slot's times are dated to each note's own recording day.
 */
export async function describeContexts(
  voiceNotes: ILeanVoiceNote[],
): Promise<Map<string, VoiceNoteContext>> {
  const described = new Map<string, VoiceNoteContext>();
  const eventIds = new Set<string>();
  const entryIds = new Set<string>();
  for (const voiceNote of voiceNotes) {
    if (!voiceNote.context) continue;
    (voiceNote.context.kind === "calendar-event" ? eventIds : entryIds).add(
      String(voiceNote.context.id),
    );
  }
  if (eventIds.size === 0 && entryIds.size === 0) return described;

  const [timeZone, events, entries] = await Promise.all([
    getAppTimeZone(),
    eventIds.size
      ? CalendarEvent.find({ _id: { $in: [...eventIds] } })
          .select("title date endDate place")
          .lean<EventRow[]>()
          .exec()
      : Promise.resolve([]),
    entryIds.size
      ? TimetableEntry.find({ _id: { $in: [...entryIds] } })
          .select("title dayOfWeek startTime endTime place color")
          .lean<TimetableRow[]>()
          .exec()
      : Promise.resolve([]),
  ]);
  const eventById = new Map(events.map((event) => [String(event._id), event]));
  const entryById = new Map(entries.map((entry) => [String(entry._id), entry]));

  for (const voiceNote of voiceNotes) {
    const context = voiceNote.context;
    if (!context) continue;
    const id = String(context.id);
    if (context.kind === "calendar-event") {
      const event = eventById.get(id);
      if (!event) continue;
      const interval = eventInterval(event);
      described.set(String(voiceNote._id), {
        kind: "calendar-event",
        id,
        title: event.title,
        start: new Date(interval.start).toISOString(),
        end: new Date(interval.end).toISOString(),
        place: event.place || undefined,
      });
      continue;
    }
    const entry = entryById.get(id);
    if (!entry) continue;
    const interval = timetableOccurrence(
      entry,
      dateKeyInTz(recordedAtOf(voiceNote), timeZone),
      timeZone,
    );
    described.set(String(voiceNote._id), {
      kind: "timetable-entry",
      id,
      title: entry.title,
      start: interval ? new Date(interval.start).toISOString() : undefined,
      end: interval ? new Date(interval.end).toISOString() : undefined,
      place: entry.place || undefined,
      color: entry.color,
    });
  }
  return described;
}
