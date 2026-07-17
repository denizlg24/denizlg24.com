import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ILeanCalendarEvent } from "@/models/CalendarEvent";
import { CalendarEventSchema } from "@/models/CalendarEvent";

const connectDBMock = mock(async () => {});
const decryptSecretMock = mock(() => "refresh-token");
const insertMock = mock(async (_input: unknown) => ({}));
const patchMock = mock(async (_input: unknown) => ({}));
const deleteMock = mock(async (_input: unknown) => ({}));
interface GoogleListMockResponse {
  data: {
    items: Record<string, unknown>[];
    nextPageToken?: string | null;
  };
}
const listMock = mock(
  async (_input: unknown): Promise<GoogleListMockResponse> => ({
    data: { items: [] },
  }),
);
const createGoogleCalendarClientMock = mock(() => ({
  events: {
    insert: insertMock,
    patch: patchMock,
    delete: deleteMock,
    list: listMock,
  },
}));
const getGoogleApiErrorStatusMock = mock((error: unknown) => {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code?: number }).code;
  }
  return undefined;
});
const sanitizeGoogleSyncErrorMock = mock((error: unknown) => {
  const status = getGoogleApiErrorStatusMock(error);
  return status
    ? `Google Calendar request failed with status ${status}`
    : "failed";
});

const eventLeanMock = mock(async (): Promise<unknown> => null);
const calendarEventFindByIdMock = mock(() => ({ lean: eventLeanMock }));
const eventFindOneLeanMock = mock(async (): Promise<unknown> => null);
const calendarEventFindOneMock = mock(() => ({ lean: eventFindOneLeanMock }));
const eventFindByIdAndUpdateLeanMock = mock(async (): Promise<unknown> => null);
const calendarEventFindByIdAndUpdateMock = mock(() => ({
  lean: eventFindByIdAndUpdateLeanMock,
}));
const calendarEventFindByIdAndDeleteMock = mock(async () => ({}));
const calendarEventCreateMock = mock(async (_input: unknown) => ({
  _id: localEventId,
}));

const connectionLeanMock = mock(async (): Promise<unknown> => null);
const connectionFindOneMock = mock(() => ({ lean: connectionLeanMock }));
const connectionFindOneAndUpdateMock = mock(async () => ({}));

const syncLeanMock = mock(async (): Promise<unknown> => null);
const syncRowsLeanMock = mock(async (): Promise<unknown[]> => []);
const syncFindOneMock = mock(() => ({ lean: syncLeanMock }));
const syncFindMock = mock(() => ({ lean: syncRowsLeanMock }));
const syncFindOneAndUpdateMock = mock(async () => ({}));
const syncFindByIdAndUpdateMock = mock(async () => ({}));
const syncFindByIdAndDeleteMock = mock(async () => ({}));
const syncUpdateManyMock = mock(async () => ({}));

mock.module("./mongodb", () => ({ connectDB: connectDBMock }));
mock.module("@/models/AppSettings", () => ({
  AppSettings: {
    findById: () => ({
      lean: () => ({ exec: async () => ({ timeZone: "Europe/Lisbon" }) }),
    }),
  },
}));
mock.module("./encrypted-secret", () => ({
  decryptSecret: decryptSecretMock,
  encryptSecret: (secret: string) => ({
    ciphertext: secret,
    iv: "iv",
    authTag: "authTag",
  }),
}));
mock.module("./google-calendar", () => ({
  createGoogleCalendarOAuthClient: () => ({
    getToken: mock(async () => ({ tokens: {} })),
  }),
  createGoogleCalendarClient: createGoogleCalendarClientMock,
  encryptedRefreshToken: (refreshToken: string) => ({
    ciphertext: refreshToken,
    iv: "iv",
    authTag: "authTag",
  }),
  extractEmailFromIdToken: () => undefined,
  getGoogleCalendarAuthorizationUrl: () =>
    "https://accounts.google.com/o/oauth2",
  getGoogleApiErrorStatus: getGoogleApiErrorStatusMock,
  GOOGLE_CALENDAR_DEFAULT_ID: "primary",
  GOOGLE_CALENDAR_EMAIL_SCOPES: ["openid", "email"],
  GOOGLE_CALENDAR_EVENTS_SCOPE:
    "https://www.googleapis.com/auth/calendar.events.owned",
  GOOGLE_CALENDAR_PROVIDER: "google",
  parseScope: () => ["https://www.googleapis.com/auth/calendar.events.owned"],
  sanitizeGoogleSyncError: sanitizeGoogleSyncErrorMock,
}));
mock.module("@/models/CalendarEvent", () => ({
  // Preserve the real schema export: bun's mock.module swaps the module
  // process-wide and never restores it, so later test files that import
  // CalendarEventSchema (via models/Journal) would otherwise fail to link.
  CalendarEventSchema,
  CalendarEvent: {
    findById: calendarEventFindByIdMock,
    findOne: calendarEventFindOneMock,
    findByIdAndUpdate: calendarEventFindByIdAndUpdateMock,
    findByIdAndDelete: calendarEventFindByIdAndDeleteMock,
    create: calendarEventCreateMock,
  },
}));
mock.module("@/models/CalendarExternalConnection", () => ({
  CalendarExternalConnection: {
    findOne: connectionFindOneMock,
    findOneAndUpdate: connectionFindOneAndUpdateMock,
  },
}));
mock.module("@/models/CalendarExternalEventSync", () => ({
  CalendarExternalEventSync: {
    findOne: syncFindOneMock,
    find: syncFindMock,
    findOneAndUpdate: syncFindOneAndUpdateMock,
    findByIdAndUpdate: syncFindByIdAndUpdateMock,
    findByIdAndDelete: syncFindByIdAndDeleteMock,
    updateMany: syncUpdateManyMock,
  },
}));

const {
  getDeterministicGoogleEventId,
  getLocalIdFromDeterministicGoogleEventId,
  syncEventToGoogle,
  syncUpcomingGoogleEventsToCalendar,
  toGoogleEventPayload,
} = await import("./google-calendar-sync");

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

beforeEach(() => {
  connectDBMock.mockClear();
  decryptSecretMock.mockClear();
  insertMock.mockReset();
  insertMock.mockResolvedValue({});
  patchMock.mockReset();
  patchMock.mockResolvedValue({});
  deleteMock.mockReset();
  deleteMock.mockResolvedValue({});
  listMock.mockReset();
  listMock.mockResolvedValue({ data: { items: [] } });
  createGoogleCalendarClientMock.mockClear();
  getGoogleApiErrorStatusMock.mockClear();
  sanitizeGoogleSyncErrorMock.mockClear();
  eventLeanMock.mockReset();
  eventLeanMock.mockResolvedValue(null);
  calendarEventFindByIdMock.mockClear();
  eventFindOneLeanMock.mockReset();
  eventFindOneLeanMock.mockResolvedValue(null);
  calendarEventFindOneMock.mockClear();
  eventFindByIdAndUpdateLeanMock.mockReset();
  eventFindByIdAndUpdateLeanMock.mockResolvedValue(null);
  calendarEventFindByIdAndUpdateMock.mockClear();
  calendarEventFindByIdAndDeleteMock.mockReset();
  calendarEventFindByIdAndDeleteMock.mockResolvedValue({});
  calendarEventCreateMock.mockReset();
  calendarEventCreateMock.mockResolvedValue({ _id: localEventId });
  connectionLeanMock.mockReset();
  connectionLeanMock.mockResolvedValue({
    provider: "google",
    enabled: true,
    calendarId: "primary",
    encryptedRefreshToken: {
      ciphertext: "ciphertext",
      iv: "iv",
      authTag: "authTag",
    },
  });
  connectionFindOneMock.mockClear();
  connectionFindOneAndUpdateMock.mockReset();
  syncLeanMock.mockReset();
  syncLeanMock.mockResolvedValue(null);
  syncRowsLeanMock.mockReset();
  syncRowsLeanMock.mockResolvedValue([]);
  syncFindOneMock.mockClear();
  syncFindMock.mockClear();
  syncFindOneAndUpdateMock.mockReset();
  syncFindByIdAndUpdateMock.mockReset();
  syncFindByIdAndDeleteMock.mockReset();
  syncUpdateManyMock.mockReset();
});

describe("toGoogleEventPayload", () => {
  test("maps timed events with deterministic one-hour end time", () => {
    const payload = toGoogleEventPayload(manualEvent());

    expect(payload.summary).toBe("Planning");
    expect(payload.location).toBe("Office");
    expect(payload.start?.dateTime).toBe("2026-07-01T10:30:00.000Z");
    expect(payload.end?.dateTime).toBe("2026-07-01T11:30:00.000Z");
    expect(payload.reminders).toEqual({ useDefault: true });
  });

  test("maps all-day events with exclusive end date", () => {
    const payload = toGoogleEventPayload(
      manualEvent({
        isAllDay: true,
        calendarDate: "2026-07-01",
      }),
    );

    expect(payload.start?.date).toBe("2026-07-01");
    expect(payload.end?.date).toBe("2026-07-02");
  });
});

test("uses deterministic Google event IDs", () => {
  expect(getDeterministicGoogleEventId(localEventId)).toBe(
    `d24${localEventId}`,
  );
  expect(getLocalIdFromDeterministicGoogleEventId(`d24${localEventId}`)).toBe(
    localEventId,
  );
});

test("insert conflict falls back to patch and records success", async () => {
  eventLeanMock.mockResolvedValue(manualEvent());
  insertMock.mockRejectedValueOnce({ code: 409 });

  const result = await syncEventToGoogle(localEventId, "upsert");

  expect(result.status).toBe("synced");
  expect(insertMock).toHaveBeenCalled();
  expect(patchMock).toHaveBeenCalledWith(
    expect.objectContaining({
      calendarId: "primary",
      eventId: `d24${localEventId}`,
    }),
  );
  expect(syncFindOneAndUpdateMock).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "google" }),
    expect.objectContaining({
      $set: expect.objectContaining({
        remoteEventId: `d24${localEventId}`,
      }),
      $unset: expect.objectContaining({
        pendingAction: "",
        lastError: "",
      }),
    }),
    { upsert: true },
  );
});

test("skips holidays outbound", async () => {
  eventLeanMock.mockResolvedValue(manualEvent({ kind: "holiday" }));

  const result = await syncEventToGoogle(localEventId, "upsert");

  expect(result.status).toBe("skipped");
  expect(insertMock).not.toHaveBeenCalled();
});

test("syncs meetings and birthdays outbound", async () => {
  eventLeanMock.mockResolvedValueOnce(manualEvent({ kind: "meeting" }));

  const meetingResult = await syncEventToGoogle(localEventId, "upsert");

  expect(meetingResult.status).toBe("synced");
  expect(insertMock).toHaveBeenCalledTimes(1);

  eventLeanMock.mockResolvedValueOnce(manualEvent({ kind: "birthday" }));

  const birthdayResult = await syncEventToGoogle(localEventId, "upsert");

  expect(birthdayResult.status).toBe("synced");
  expect(insertMock).toHaveBeenCalledTimes(2);
});

test("delete not found is treated as successful cleanup", async () => {
  syncRowsLeanMock.mockResolvedValue([
    {
      _id: "sync-row",
      provider: "google",
      localEventId,
      remoteCalendarId: "primary",
      remoteEventId: `d24${localEventId}`,
    },
  ]);
  deleteMock.mockRejectedValueOnce({ code: 404 });

  const result = await syncEventToGoogle(localEventId, "delete");

  expect(result.status).toBe("synced");
  expect(syncFindByIdAndDeleteMock).toHaveBeenCalledWith("sync-row");
});

test("imports unmapped Google flight events", async () => {
  listMock.mockResolvedValue({
    data: {
      items: [
        {
          id: "google-flight-1",
          summary: "Flight TP 123 to Lisbon",
          location: "LIS Terminal 1",
          status: "confirmed",
          start: { dateTime: "2026-07-02T10:00:00.000Z" },
          end: { dateTime: "2026-07-02T12:30:00.000Z" },
          htmlLink: "https://calendar.google.com/event?eid=flight",
        },
      ],
    },
  });

  const result = await syncUpcomingGoogleEventsToCalendar({
    start: new Date("2026-07-01T00:00:00.000Z"),
    end: new Date("2026-07-10T00:00:00.000Z"),
  });

  expect(result).toMatchObject({
    totalCount: 1,
    importedCount: 1,
    failedCount: 0,
  });
  expect(calendarEventCreateMock).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "flight",
      title: "Flight TP 123 to Lisbon",
      place: "LIS Terminal 1",
      endDate: new Date("2026-07-02T12:30:00.000Z"),
      source: expect.objectContaining({
        provider: "google",
        providerKey: "google:primary:google-flight-1",
      }),
    }),
  );
  expect(syncFindOneAndUpdateMock).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "google",
      remoteCalendarId: "primary",
    }),
    expect.objectContaining({
      $set: expect.objectContaining({
        remoteEventId: "google-flight-1",
      }),
    }),
    { upsert: true },
  );
});

test("maps deterministic app-created Google events without duplicating", async () => {
  const existing = manualEvent({ kind: "meeting" });
  eventLeanMock.mockResolvedValue(existing);
  eventFindByIdAndUpdateLeanMock.mockResolvedValue({
    ...existing,
    title: "Updated in Google",
  });
  listMock.mockResolvedValue({
    data: {
      items: [
        {
          id: `d24${localEventId}`,
          summary: "Updated in Google",
          status: "confirmed",
          attendees: [{ email: "a@example.com" }],
          start: { dateTime: "2026-07-02T10:00:00.000Z" },
          end: { dateTime: "2026-07-02T11:00:00.000Z" },
        },
      ],
    },
  });

  const result = await syncUpcomingGoogleEventsToCalendar({
    start: new Date("2026-07-01T00:00:00.000Z"),
    end: new Date("2026-07-10T00:00:00.000Z"),
  });

  expect(result).toMatchObject({
    totalCount: 1,
    importedCount: 0,
    updatedCount: 1,
  });
  expect(calendarEventCreateMock).not.toHaveBeenCalled();
  expect(calendarEventFindByIdAndUpdateMock).toHaveBeenCalledWith(
    localEventId,
    expect.objectContaining({
      $set: expect.objectContaining({
        title: "Updated in Google",
        kind: "meeting",
      }),
    }),
    { returnDocument: "after" },
  );
});

test("skips inbound Google rows with pending local outbound changes", async () => {
  syncLeanMock.mockResolvedValue({
    _id: "sync-row",
    provider: "google",
    localEventId,
    remoteCalendarId: "primary",
    remoteEventId: "google-event-1",
    pendingAction: "upsert",
  });
  listMock.mockResolvedValue({
    data: {
      items: [
        {
          id: "google-event-1",
          summary: "Remote edit",
          status: "confirmed",
          start: { dateTime: "2026-07-02T10:00:00.000Z" },
          end: { dateTime: "2026-07-02T11:00:00.000Z" },
        },
      ],
    },
  });

  const result = await syncUpcomingGoogleEventsToCalendar({
    start: new Date("2026-07-01T00:00:00.000Z"),
    end: new Date("2026-07-10T00:00:00.000Z"),
  });

  expect(result).toMatchObject({
    totalCount: 1,
    skippedCount: 1,
    updatedCount: 0,
    importedCount: 0,
  });
  expect(calendarEventCreateMock).not.toHaveBeenCalled();
  expect(calendarEventFindByIdAndUpdateMock).not.toHaveBeenCalled();
});
