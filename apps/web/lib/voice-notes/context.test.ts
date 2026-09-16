import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

interface EventRow {
  _id: string;
  title: string;
  date: Date;
  endDate?: Date;
  place?: string;
}
interface TimetableRow {
  _id: string;
  title: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  place?: string;
  color: string;
}

let events: EventRow[] = [];
let timetable: TimetableRow[] = [];
let timetableQuery: Record<string, unknown> | undefined;

function chain<T>(rows: () => T[]) {
  return {
    select: () => ({ lean: () => ({ exec: async () => rows() }) }),
  };
}

mock.module("@/lib/mongodb", () => ({ connectDB: async () => undefined }));
mock.module("@/lib/calendar-events", () => ({
  visibleCalendarFilter: () => ({}),
}));
mock.module("@/models/CalendarEvent", () => ({
  CalendarEvent: { find: () => chain(() => events) },
}));
mock.module("@/models/TimetableEntry", () => ({
  TimetableEntry: {
    find: (query: Record<string, unknown>) => {
      timetableQuery = query;
      return chain(() => timetable);
    },
  },
}));
mock.module("@/models/VoiceNote", () => ({ VoiceNote: {} }));
mock.module("@/lib/timezone", () => ({
  getAppTimeZone: async () => "Europe/Copenhagen",
  dateKeyInTz: (date: Date | number | string, timeZone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(date)),
}));

const { deriveContext, listContextCandidates } = await import("./context");

const MINUTE = 60_000;
// Thursday 2026-09-10, 09:37 in Copenhagen (UTC+2).
const recordedAt = new Date("2026-09-10T07:37:00.000Z");

beforeEach(() => {
  events = [];
  timetable = [];
  timetableQuery = undefined;
});

describe("deriveContext", () => {
  test("prefers a timed calendar event over the timetable", async () => {
    events = [
      {
        _id: "65f000000000000000000001",
        title: "Algorithms exam review",
        date: new Date("2026-09-10T07:30:00.000Z"),
        endDate: new Date("2026-09-10T09:00:00.000Z"),
      },
    ];
    timetable = [
      {
        _id: "65f000000000000000000002",
        title: "Algorithms",
        dayOfWeek: 3,
        startTime: "09:30",
        endTime: "11:00",
        color: "blue",
      },
    ];
    const context = await deriveContext(recordedAt, 45 * MINUTE);
    expect(context?.kind).toBe("calendar-event");
    expect(String(context?.id)).toBe("65f000000000000000000001");
  });

  test("falls back to the timetable slot on the recording's local weekday", async () => {
    timetable = [
      {
        _id: "65f000000000000000000002",
        title: "Algorithms",
        dayOfWeek: 3,
        startTime: "09:30",
        endTime: "11:00",
        color: "blue",
      },
    ];
    const context = await deriveContext(recordedAt, 45 * MINUTE);
    expect(context?.kind).toBe("timetable-entry");
    // Thursday is 3 when Monday is 0.
    expect(timetableQuery?.dayOfWeek).toEqual({ $in: [3] });
  });

  test("ignores a slot the recording only brushes past", async () => {
    timetable = [
      {
        _id: "65f000000000000000000003",
        title: "Next class",
        dayOfWeek: 3,
        startTime: "10:20",
        endTime: "12:00",
        color: "red",
      },
    ];
    // 09:37 + 45 min ends 10:22: two minutes of overlap.
    expect(await deriveContext(recordedAt, 45 * MINUTE)).toBeNull();
  });

  test("links a short memo made during an event", async () => {
    events = [
      {
        _id: "65f000000000000000000004",
        title: "Standup",
        date: new Date("2026-09-10T07:30:00.000Z"),
        endDate: new Date("2026-09-10T07:45:00.000Z"),
      },
    ];
    const context = await deriveContext(recordedAt, 2 * MINUTE);
    expect(String(context?.id)).toBe("65f000000000000000000004");
  });

  test("treats an event without an end as an hour long", async () => {
    events = [
      {
        _id: "65f000000000000000000005",
        title: "Open ended",
        date: new Date("2026-09-10T07:00:00.000Z"),
      },
    ];
    const context = await deriveContext(recordedAt, 20 * MINUTE);
    expect(String(context?.id)).toBe("65f000000000000000000005");
  });
});

describe("listContextCandidates", () => {
  test("orders by overlap and dates slot times to the recording day", async () => {
    timetable = [
      {
        _id: "65f000000000000000000006",
        title: "Morning",
        dayOfWeek: 3,
        startTime: "08:00",
        endTime: "09:45",
        color: "green",
      },
      {
        _id: "65f000000000000000000007",
        title: "Lecture",
        dayOfWeek: 3,
        startTime: "09:30",
        endTime: "11:00",
        color: "blue",
      },
    ];
    const { timetableEntries } = await listContextCandidates(
      recordedAt,
      60 * MINUTE,
    );
    expect(timetableEntries.map((entry) => entry.title)).toEqual([
      "Lecture",
      "Morning",
    ]);
    expect(timetableEntries[0]?.start).toBe("2026-09-10T07:30:00.000Z");
    expect(timetableEntries[1]?.overlapMs).toBe(8 * MINUTE);
  });
});
