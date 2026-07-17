import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ILeanCalendarEvent } from "@/models/CalendarEvent";
import { CalendarEventSchema } from "@/models/CalendarEvent";

const connectDBMock = mock(async () => {});
const eventLeanMock = mock(async (): Promise<unknown> => null);
const calendarEventFindByIdMock = mock(() => ({ lean: eventLeanMock }));
const calendarEventFindByIdAndUpdateMock = mock(
  (_id: string, _update: unknown) => ({
    lean: mock(async (): Promise<unknown> => null),
  }),
);

mock.module("./mongodb", () => ({ connectDB: connectDBMock }));
mock.module("@/models/AppSettings", () => ({
  AppSettings: {
    findById: () => ({
      lean: () => ({ exec: async () => ({ timeZone: "Europe/Lisbon" }) }),
    }),
  },
}));
mock.module("@/models/CalendarEvent", () => ({
  // Preserve the real schema export: bun's mock.module swaps the module
  // process-wide and never restores it, so later test files that import
  // CalendarEventSchema (via models/Journal) would otherwise fail to link.
  CalendarEventSchema,
  CalendarEvent: {
    findById: calendarEventFindByIdMock,
    findByIdAndUpdate: calendarEventFindByIdAndUpdateMock,
  },
}));

const { updateCalendarEvent } = await import("./calendar-events");

const localEventId = "64f000000000000000000001";

function manualEvent(
  overrides: Partial<ILeanCalendarEvent> = {},
): ILeanCalendarEvent {
  return {
    _id: localEventId,
    date: new Date("2026-07-01T10:30:00.000Z"),
    calendarDate: "2026-07-01",
    isAllDay: false,
    kind: "manual",
    title: "Planning",
    place: "Office",
    links: [],
    status: "scheduled",
    notifyBySlack: false,
    isNotificationSent: false,
    notifyBeforeMinutes: 15,
    ...overrides,
  };
}

function applyCalendarUpdate(
  existing: ILeanCalendarEvent,
  update: unknown,
): ILeanCalendarEvent {
  const updateDocument = update as
    | Partial<ILeanCalendarEvent>
    | {
        $set: Partial<ILeanCalendarEvent>;
        $unset?: Record<string, "">;
      };
  const set = "$set" in updateDocument ? updateDocument.$set : updateDocument;
  const next = { ...existing, ...set };

  if (
    "$unset" in updateDocument &&
    updateDocument.$unset?.notifyAt !== undefined
  ) {
    delete next.notifyAt;
  }

  return next;
}

beforeEach(() => {
  connectDBMock.mockClear();
  eventLeanMock.mockReset();
  eventLeanMock.mockResolvedValue(null);
  calendarEventFindByIdMock.mockClear();
  calendarEventFindByIdAndUpdateMock.mockReset();
});

describe("updateCalendarEvent", () => {
  test("sets notifyAt when Slack notifications are enabled without changing the date", async () => {
    const existing = manualEvent();
    eventLeanMock.mockResolvedValue(existing);
    calendarEventFindByIdAndUpdateMock.mockImplementation((_id, update) => ({
      lean: mock(async () => applyCalendarUpdate(existing, update)),
    }));

    const result = await updateCalendarEvent({
      id: localEventId,
      data: { notifyBySlack: true },
    });

    const update = calendarEventFindByIdAndUpdateMock.mock.calls[0]?.[1] as
      | Partial<ILeanCalendarEvent>
      | undefined;

    expect(result?.notifyBySlack).toBe(true);
    expect(update?.notifyAt).toEqual(new Date("2026-07-01T10:15:00.000Z"));
    expect(update?.isNotificationSent).toBe(false);
  });

  test("unsets notifyAt when Slack notifications are disabled", async () => {
    const existing = manualEvent({
      notifyBySlack: true,
      isNotificationSent: true,
      notifyAt: new Date("2026-07-01T10:15:00.000Z"),
    });
    eventLeanMock.mockResolvedValue(existing);
    calendarEventFindByIdAndUpdateMock.mockImplementation((_id, update) => ({
      lean: mock(async () => applyCalendarUpdate(existing, update)),
    }));

    const result = await updateCalendarEvent({
      id: localEventId,
      data: { notifyBySlack: false },
    });

    const update = calendarEventFindByIdAndUpdateMock.mock.calls[0]?.[1] as
      | {
          $set?: Partial<ILeanCalendarEvent>;
          $unset?: Record<string, "">;
        }
      | undefined;

    expect(result?.notifyBySlack).toBe(false);
    expect(result?.notifyAt).toBeUndefined();
    expect(update?.$set?.isNotificationSent).toBe(false);
    expect(update?.$unset).toEqual({ notifyAt: "" });
  });

  test("resets sent state and recomputes notifyAt when the schedule changes", async () => {
    const existing = manualEvent({
      notifyBySlack: true,
      isNotificationSent: true,
      notifyAt: new Date("2026-07-01T10:15:00.000Z"),
    });
    eventLeanMock.mockResolvedValue(existing);
    calendarEventFindByIdAndUpdateMock.mockImplementation((_id, update) => ({
      lean: mock(async () => applyCalendarUpdate(existing, update)),
    }));

    const result = await updateCalendarEvent({
      id: localEventId,
      data: { notifyBeforeMinutes: 30 },
    });

    const update = calendarEventFindByIdAndUpdateMock.mock.calls[0]?.[1] as
      | Partial<ILeanCalendarEvent>
      | undefined;

    expect(result?.isNotificationSent).toBe(false);
    expect(update?.notifyAt).toEqual(new Date("2026-07-01T10:00:00.000Z"));
  });
});
