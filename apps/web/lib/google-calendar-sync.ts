import crypto from "node:crypto";
import type { calendar_v3 } from "googleapis";
import mongoose from "mongoose";
import { CalendarEvent, type ILeanCalendarEvent } from "@/models/CalendarEvent";
import {
  CalendarExternalConnection,
  type ILeanCalendarExternalConnection,
} from "@/models/CalendarExternalConnection";
import {
  CalendarExternalEventSync,
  type ILeanCalendarExternalEventSync,
} from "@/models/CalendarExternalEventSync";
import {
  calendarDateFromDate,
  serializeCalendarEvent,
} from "./calendar-events";
import { decryptSecret } from "./encrypted-secret";
import {
  createGoogleCalendarClient,
  GOOGLE_CALENDAR_DEFAULT_ID,
  GOOGLE_CALENDAR_PROVIDER,
  getGoogleApiErrorStatus,
  sanitizeGoogleSyncError,
} from "./google-calendar";
import { connectDB } from "./mongodb";

export type GoogleCalendarSyncAction = "upsert" | "delete";

const DEFAULT_TIMED_EVENT_DURATION_MS = 60 * 60 * 1000;
const DEFAULT_INBOUND_WINDOW_DAYS = 90;
const OUTBOUND_SYNCABLE_KINDS = new Set<ILeanCalendarEvent["kind"]>([
  "manual",
  "meeting",
  "flight",
  "birthday",
]);

export interface GoogleCalendarSyncResult {
  status: "synced" | "failed" | "skipped";
  action: GoogleCalendarSyncAction;
  localEventId: string;
  remoteEventId?: string;
  error?: string;
}

export interface GoogleCalendarInboundSyncResult {
  totalCount: number;
  importedCount: number;
  updatedCount: number;
  deletedCount: number;
  skippedCount: number;
  failedCount: number;
}

type CalendarEventWriteData = Omit<ILeanCalendarEvent, "_id" | "links"> & {
  links: { label: string; icon?: string; url: string }[];
};

function addDaysToCalendarDate(calendarDate: string, days: number) {
  const date = new Date(`${calendarDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getLinksDescription(
  links: { label: string; url: string }[] | undefined,
) {
  if (!links?.length) return undefined;
  return links.map((link) => `${link.label}: ${link.url}`).join("\n");
}

export function getDeterministicGoogleEventId(localEventId: string) {
  return `d24${localEventId.toLowerCase()}`;
}

export function getLocalIdFromDeterministicGoogleEventId(
  remoteEventId: string,
) {
  if (!remoteEventId.startsWith("d24")) return null;
  const candidate = remoteEventId.slice(3);
  return mongoose.Types.ObjectId.isValid(candidate) ? candidate : null;
}

export function isGoogleOutboundSyncableKind(kind: ILeanCalendarEvent["kind"]) {
  return OUTBOUND_SYNCABLE_KINDS.has(kind);
}

export function toGoogleEventPayload(
  event: ReturnType<typeof serializeCalendarEvent>,
): calendar_v3.Schema$Event {
  const description = getLinksDescription(event.links);

  if (event.isAllDay) {
    return {
      summary: event.title,
      location: event.place,
      description,
      status: event.status === "canceled" ? "cancelled" : "confirmed",
      start: { date: event.calendarDate },
      end: {
        date: event.endDate
          ? calendarDateFromDate(event.endDate)
          : addDaysToCalendarDate(event.calendarDate, 1),
      },
      reminders: { useDefault: true },
    };
  }

  const start = new Date(event.date);
  const end = event.endDate
    ? new Date(event.endDate)
    : new Date(start.getTime() + DEFAULT_TIMED_EVENT_DURATION_MS);

  return {
    summary: event.title,
    location: event.place,
    description,
    status: event.status === "canceled" ? "cancelled" : "confirmed",
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    reminders: { useDefault: true },
  };
}

export function getGoogleEventPayloadHash(payload: calendar_v3.Schema$Event) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function getGoogleSourceProviderKey(
  remoteCalendarId: string,
  remoteEventId: string,
) {
  return `google:${remoteCalendarId}:${remoteEventId}`;
}

function getGoogleEventText(event: calendar_v3.Schema$Event) {
  return [
    event.summary,
    event.location,
    event.description,
    event.source?.title,
    event.creator?.email,
    event.organizer?.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function classifyGoogleCalendarEvent(
  event: calendar_v3.Schema$Event,
): ILeanCalendarEvent["kind"] {
  if (event.eventType === "birthday") return "birthday";

  const text = getGoogleEventText(event);
  if (
    /\b(flight|boarding|airport|terminal|gate|airline|airways|departure|arrival)\b/.test(
      text,
    )
  ) {
    return "flight";
  }

  if (
    event.hangoutLink ||
    event.conferenceData?.entryPoints?.length ||
    event.attendees?.length ||
    /\b(meeting|standup|sync|call|interview|demo|review|1:1|one-on-one)\b/.test(
      text,
    )
  ) {
    return "meeting";
  }

  return "manual";
}

function getGoogleEventLinks(event: calendar_v3.Schema$Event) {
  const links: { label: string; url: string }[] = [];
  const seen = new Set<string>();
  const addLink = (label: string, url: string | null | undefined) => {
    if (!url || seen.has(url)) return;
    links.push({ label, url });
    seen.add(url);
  };

  addLink("Google Meet", event.hangoutLink);
  for (const entryPoint of event.conferenceData?.entryPoints ?? []) {
    if (entryPoint.entryPointType === "video") {
      addLink(entryPoint.label || "Video call", entryPoint.uri);
    }
  }
  addLink("Google Calendar", event.htmlLink);

  return links;
}

function getGoogleEventMetadata(event: calendar_v3.Schema$Event) {
  return {
    eventType: event.eventType,
    htmlLink: event.htmlLink,
    iCalUID: event.iCalUID,
    recurringEventId: event.recurringEventId,
    sourceTitle: event.source?.title,
    sourceUrl: event.source?.url,
    updated: event.updated,
  };
}

function isValidDate(date: Date) {
  return !Number.isNaN(date.getTime());
}

function getGoogleStartDate(event: calendar_v3.Schema$Event) {
  if (event.start?.date) return anchorGoogleDate(event.start.date);
  if (event.start?.dateTime) {
    const date = new Date(event.start.dateTime);
    return isValidDate(date) ? date : null;
  }
  return null;
}

function getGoogleEndDate(event: calendar_v3.Schema$Event) {
  if (event.end?.date) return anchorGoogleDate(event.end.date);
  if (event.end?.dateTime) {
    const date = new Date(event.end.dateTime);
    return isValidDate(date) ? date : undefined;
  }
  return undefined;
}

function anchorGoogleDate(calendarDate: string) {
  return new Date(`${calendarDate}T12:00:00.000Z`);
}

function toLocalEventDataFromGoogleEvent(
  event: calendar_v3.Schema$Event,
  remoteCalendarId: string,
) {
  if (!event.id) return null;

  const start = getGoogleStartDate(event);
  if (!start) return null;

  const isAllDay = Boolean(event.start?.date);
  const calendarDate = event.start?.date ?? calendarDateFromDate(start);
  const endDate = getGoogleEndDate(event);
  const remoteEventId = event.id;

  return {
    date: isAllDay ? anchorGoogleDate(calendarDate) : start,
    ...(endDate ? { endDate } : {}),
    calendarDate,
    isAllDay,
    kind: classifyGoogleCalendarEvent(event),
    title: event.summary?.trim() || "(No title)",
    place: event.location?.trim() || undefined,
    links: getGoogleEventLinks(event),
    status: event.status === "cancelled" ? "canceled" : "scheduled",
    notifyBySlack: false,
    isNotificationSent: false,
    notifyBeforeMinutes: 15,
    source: {
      provider: GOOGLE_CALENDAR_PROVIDER,
      providerKey: getGoogleSourceProviderKey(remoteCalendarId, remoteEventId),
      isCustomized: false,
      isSuppressed: false,
      metadata: getGoogleEventMetadata(event),
    },
  } satisfies CalendarEventWriteData;
}

function getLocalEventDataHash(data: CalendarEventWriteData) {
  return getGoogleEventPayloadHash(
    toGoogleEventPayload({
      _id: "",
      ...data,
      links: data.links.map((link, index) => ({
        _id: String(index),
        ...link,
      })),
    }),
  );
}

function getGoogleInboundUpdate(
  data: CalendarEventWriteData,
  existing: ILeanCalendarEvent,
) {
  const { source, ...update } = data;

  if (existing.kind === "birthday") {
    update.kind = "birthday";
  }

  if (existing.source?.provider === GOOGLE_CALENDAR_PROVIDER) {
    return { ...update, source };
  }

  if (existing.source) {
    return {
      ...update,
      source: {
        ...existing.source,
        isCustomized: true,
      },
    };
  }

  return update;
}

function objectIdFor(localEventId: string) {
  if (!mongoose.Types.ObjectId.isValid(localEventId)) {
    throw new Error("Invalid calendar event id");
  }
  return new mongoose.Types.ObjectId(localEventId);
}

async function getGoogleConnection() {
  return CalendarExternalConnection.findOne({
    provider: GOOGLE_CALENDAR_PROVIDER,
  }).lean<ILeanCalendarExternalConnection | null>();
}

async function markConnectionSyncFailure(error: string) {
  await CalendarExternalConnection.findOneAndUpdate(
    { provider: GOOGLE_CALENDAR_PROVIDER },
    { $set: { lastSyncError: error } },
  );
}

async function markConnectionSyncSuccess() {
  await CalendarExternalConnection.findOneAndUpdate(
    { provider: GOOGLE_CALENDAR_PROVIDER },
    {
      $set: { lastSyncAt: new Date() },
      $unset: { lastSyncError: "" },
    },
  );
}

async function getCalendarApi(connection: ILeanCalendarExternalConnection) {
  const refreshToken = decryptSecret(connection.encryptedRefreshToken);
  return createGoogleCalendarClient(refreshToken);
}

async function markPausedPending(
  localEventId: string,
  action: GoogleCalendarSyncAction,
) {
  if (action === "upsert") {
    await CalendarExternalEventSync.updateMany(
      {
        provider: GOOGLE_CALENDAR_PROVIDER,
        localEventId: objectIdFor(localEventId),
      },
      { $set: { pendingAction: action } },
    );
    return;
  }

  await CalendarExternalEventSync.updateMany(
    {
      provider: GOOGLE_CALENDAR_PROVIDER,
      localEventId: objectIdFor(localEventId),
    },
    { $set: { pendingAction: action } },
  );
}

async function recordUpsertFailure({
  localEventId,
  remoteCalendarId,
  remoteEventId,
  error,
}: {
  localEventId: string;
  remoteCalendarId: string;
  remoteEventId: string;
  error: string;
}) {
  await CalendarExternalEventSync.findOneAndUpdate(
    {
      provider: GOOGLE_CALENDAR_PROVIDER,
      localEventId: objectIdFor(localEventId),
      remoteCalendarId,
    },
    {
      $set: {
        provider: GOOGLE_CALENDAR_PROVIDER,
        localEventId: objectIdFor(localEventId),
        remoteCalendarId,
        remoteEventId,
        pendingAction: "upsert",
        lastError: error,
      },
    },
    { upsert: true },
  );
  await markConnectionSyncFailure(error);
}

async function recordUpsertSuccess({
  localEventId,
  remoteCalendarId,
  remoteEventId,
  hash,
}: {
  localEventId: string;
  remoteCalendarId: string;
  remoteEventId: string;
  hash: string;
}) {
  await CalendarExternalEventSync.findOneAndUpdate(
    {
      provider: GOOGLE_CALENDAR_PROVIDER,
      localEventId: objectIdFor(localEventId),
      remoteCalendarId,
    },
    {
      $set: {
        provider: GOOGLE_CALENDAR_PROVIDER,
        localEventId: objectIdFor(localEventId),
        remoteCalendarId,
        remoteEventId,
        lastSyncedHash: hash,
        lastSyncedAt: new Date(),
      },
      $unset: {
        pendingAction: "",
        lastError: "",
      },
    },
    { upsert: true },
  );
  await markConnectionSyncSuccess();
}

async function syncUpsert(
  localEventId: string,
  connection: ILeanCalendarExternalConnection,
): Promise<GoogleCalendarSyncResult> {
  const event = await CalendarEvent.findById(localEventId).lean();
  if (!event) {
    return { status: "skipped", action: "upsert", localEventId };
  }

  const serialized = serializeCalendarEvent(event);
  if (!isGoogleOutboundSyncableKind(serialized.kind)) {
    return { status: "skipped", action: "upsert", localEventId };
  }

  const remoteCalendarId = connection.calendarId || GOOGLE_CALENDAR_DEFAULT_ID;
  const existingSync = await CalendarExternalEventSync.findOne({
    provider: GOOGLE_CALENDAR_PROVIDER,
    localEventId: objectIdFor(localEventId),
    remoteCalendarId,
  }).lean<ILeanCalendarExternalEventSync | null>();
  const remoteEventId =
    existingSync?.remoteEventId ?? getDeterministicGoogleEventId(localEventId);
  const payload = toGoogleEventPayload(serialized);
  const hash = getGoogleEventPayloadHash(payload);

  if (
    existingSync?.lastSyncedHash === hash &&
    !existingSync.pendingAction &&
    !existingSync.lastError
  ) {
    return {
      status: "skipped",
      action: "upsert",
      localEventId,
      remoteEventId,
    };
  }

  try {
    const calendar = await getCalendarApi(connection);
    if (existingSync) {
      await calendar.events.patch({
        calendarId: remoteCalendarId,
        eventId: remoteEventId,
        requestBody: payload,
      });
    } else {
      try {
        await calendar.events.insert({
          calendarId: remoteCalendarId,
          requestBody: { ...payload, id: remoteEventId },
        });
      } catch (error) {
        if (getGoogleApiErrorStatus(error) !== 409) throw error;
        await calendar.events.patch({
          calendarId: remoteCalendarId,
          eventId: remoteEventId,
          requestBody: payload,
        });
      }
    }

    await recordUpsertSuccess({
      localEventId,
      remoteCalendarId,
      remoteEventId,
      hash,
    });

    return {
      status: "synced",
      action: "upsert",
      localEventId,
      remoteEventId,
    };
  } catch (error) {
    const message = sanitizeGoogleSyncError(error);
    await recordUpsertFailure({
      localEventId,
      remoteCalendarId,
      remoteEventId,
      error: message,
    });
    return {
      status: "failed",
      action: "upsert",
      localEventId,
      remoteEventId,
      error: message,
    };
  }
}

async function syncDelete(
  localEventId: string,
  connection: ILeanCalendarExternalConnection,
): Promise<GoogleCalendarSyncResult> {
  const syncRows = await CalendarExternalEventSync.find({
    provider: GOOGLE_CALENDAR_PROVIDER,
    localEventId: objectIdFor(localEventId),
  }).lean<ILeanCalendarExternalEventSync[]>();

  if (syncRows.length === 0) {
    return { status: "skipped", action: "delete", localEventId };
  }

  const calendar = await getCalendarApi(connection);

  for (const syncRow of syncRows) {
    try {
      await calendar.events.delete({
        calendarId: syncRow.remoteCalendarId,
        eventId: syncRow.remoteEventId,
      });
      await CalendarExternalEventSync.findByIdAndDelete(syncRow._id);
      await markConnectionSyncSuccess();
    } catch (error) {
      const status = getGoogleApiErrorStatus(error);
      if (status === 404 || status === 410) {
        await CalendarExternalEventSync.findByIdAndDelete(syncRow._id);
        await markConnectionSyncSuccess();
        continue;
      }

      const message = sanitizeGoogleSyncError(error);
      await CalendarExternalEventSync.findByIdAndUpdate(syncRow._id, {
        $set: {
          pendingAction: "delete",
          lastError: message,
        },
      });
      await markConnectionSyncFailure(message);
      return {
        status: "failed",
        action: "delete",
        localEventId,
        remoteEventId: syncRow.remoteEventId,
        error: message,
      };
    }
  }

  return { status: "synced", action: "delete", localEventId };
}

type GoogleInboundEventResult =
  | "imported"
  | "updated"
  | "deleted"
  | "skipped"
  | "failed";

async function findMappedLocalEvent(
  syncRow: ILeanCalendarExternalEventSync | null,
) {
  if (!syncRow) return null;

  const event = await CalendarEvent.findById(
    syncRow.localEventId,
  ).lean<ILeanCalendarEvent | null>();
  if (event) return event;

  await CalendarExternalEventSync.findByIdAndDelete(syncRow._id);
  return null;
}

async function findDeterministicLocalEvent(remoteEventId: string) {
  const localEventId = getLocalIdFromDeterministicGoogleEventId(remoteEventId);
  if (!localEventId) return null;

  return CalendarEvent.findById(localEventId).lean<ILeanCalendarEvent | null>();
}

async function applyDeletedGoogleEvent(
  syncRow: ILeanCalendarExternalEventSync | null,
): Promise<GoogleInboundEventResult> {
  if (!syncRow || syncRow.pendingAction || syncRow.lastError) {
    return "skipped";
  }

  const existing = await findMappedLocalEvent(syncRow);
  if (!existing) return "skipped";

  if (existing.source?.provider === GOOGLE_CALENDAR_PROVIDER) {
    await Promise.all([
      CalendarEvent.findByIdAndDelete(existing._id),
      CalendarExternalEventSync.findByIdAndDelete(syncRow._id),
    ]);
    await markConnectionSyncSuccess();
    return "deleted";
  }

  await CalendarEvent.findByIdAndUpdate(existing._id, {
    $set: { status: "canceled" },
  });
  await markConnectionSyncSuccess();
  return existing.status === "canceled" ? "skipped" : "updated";
}

async function applyActiveGoogleEvent(
  event: calendar_v3.Schema$Event,
  remoteCalendarId: string,
  syncRow: ILeanCalendarExternalEventSync | null,
): Promise<GoogleInboundEventResult> {
  if (!event.id) return "skipped";
  if (syncRow?.pendingAction || syncRow?.lastError) return "skipped";

  const data = toLocalEventDataFromGoogleEvent(event, remoteCalendarId);
  if (!data) return "skipped";

  const hash = getLocalEventDataHash(data);
  let existing = await findMappedLocalEvent(syncRow);

  if (!existing) {
    existing = await findDeterministicLocalEvent(event.id);
  }

  if (!existing) {
    existing = await CalendarEvent.findOne({
      "source.provider": GOOGLE_CALENDAR_PROVIDER,
      "source.providerKey": data.source.providerKey,
    }).lean<ILeanCalendarEvent | null>();
  }

  if (
    existing &&
    syncRow?.lastSyncedHash === hash &&
    !syncRow.pendingAction &&
    !syncRow.lastError
  ) {
    return "skipped";
  }

  if (existing) {
    const update = getGoogleInboundUpdate(data, existing);
    const unset: Record<string, ""> = {};
    if (update.place === undefined) {
      delete update.place;
      unset.place = "";
    }
    if (update.endDate === undefined) {
      delete update.endDate;
      unset.endDate = "";
    }
    const updated = await CalendarEvent.findByIdAndUpdate(
      existing._id,
      {
        $set: update,
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
      { returnDocument: "after" },
    ).lean<ILeanCalendarEvent | null>();

    if (!updated) return "failed";

    await recordUpsertSuccess({
      localEventId: String(updated._id),
      remoteCalendarId,
      remoteEventId: event.id,
      hash,
    });
    return "updated";
  }

  const created = await CalendarEvent.create(data);
  await recordUpsertSuccess({
    localEventId: String(created._id),
    remoteCalendarId,
    remoteEventId: event.id,
    hash,
  });

  return "imported";
}

async function syncGoogleEventIntoCalendar(
  event: calendar_v3.Schema$Event,
  remoteCalendarId: string,
) {
  if (!event.id) return "skipped" satisfies GoogleInboundEventResult;

  const syncRow = await CalendarExternalEventSync.findOne({
    provider: GOOGLE_CALENDAR_PROVIDER,
    remoteCalendarId,
    remoteEventId: event.id,
  }).lean<ILeanCalendarExternalEventSync | null>();
  if (event.status === "cancelled") {
    return applyDeletedGoogleEvent(syncRow);
  }

  return applyActiveGoogleEvent(event, remoteCalendarId, syncRow);
}

export async function syncEventToGoogle(
  localEventId: string,
  action: GoogleCalendarSyncAction,
): Promise<GoogleCalendarSyncResult> {
  await connectDB();

  const connection = await getGoogleConnection();
  if (!connection) {
    return { status: "skipped", action, localEventId };
  }

  if (!connection.enabled) {
    await markPausedPending(localEventId, action);
    return { status: "skipped", action, localEventId };
  }

  if (action === "delete") return syncDelete(localEventId, connection);
  return syncUpsert(localEventId, connection);
}

export async function syncUpcomingGoogleEventsToCalendar({
  start = new Date(),
  end = new Date(Date.now() + DEFAULT_INBOUND_WINDOW_DAYS * 24 * 60 * 60_000),
}: {
  start?: Date;
  end?: Date;
} = {}): Promise<GoogleCalendarInboundSyncResult> {
  await connectDB();

  const connection = await getGoogleConnection();
  if (!connection?.enabled) {
    return {
      totalCount: 0,
      importedCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  const remoteCalendarId = connection.calendarId || GOOGLE_CALENDAR_DEFAULT_ID;
  const result: GoogleCalendarInboundSyncResult = {
    totalCount: 0,
    importedCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  };

  try {
    const calendar = await getCalendarApi(connection);
    let pageToken: string | undefined;

    do {
      const response = await calendar.events.list({
        calendarId: remoteCalendarId,
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        showDeleted: true,
        orderBy: "startTime",
        maxResults: 2500,
        pageToken,
      });

      for (const event of response.data.items ?? []) {
        result.totalCount++;
        try {
          const status = await syncGoogleEventIntoCalendar(
            event,
            remoteCalendarId,
          );
          if (status === "imported") result.importedCount++;
          if (status === "updated") result.updatedCount++;
          if (status === "deleted") result.deletedCount++;
          if (status === "skipped") result.skippedCount++;
          if (status === "failed") result.failedCount++;
        } catch (error) {
          result.failedCount++;
          await markConnectionSyncFailure(sanitizeGoogleSyncError(error));
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    if (result.failedCount === 0) {
      await markConnectionSyncSuccess();
    }
  } catch (error) {
    result.failedCount++;
    await markConnectionSyncFailure(sanitizeGoogleSyncError(error));
  }

  return result;
}

export async function backfillManualEventsToGoogle({
  start,
  end,
}: {
  start: Date;
  end: Date;
}) {
  await connectDB();
  const startDate = calendarDateFromDate(start);
  const endDate = calendarDateFromDate(end);
  const events = await CalendarEvent.find({
    kind: { $in: [...OUTBOUND_SYNCABLE_KINDS] },
    $or: [
      { date: { $gte: start, $lte: end } },
      { calendarDate: { $gte: startDate, $lte: endDate } },
    ],
  })
    .select("_id")
    .lean();

  let syncedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const event of events) {
    const result = await syncEventToGoogle(String(event._id), "upsert");
    if (result.status === "synced") syncedCount++;
    if (result.status === "failed") failedCount++;
    if (result.status === "skipped") skippedCount++;
  }

  return {
    totalCount: events.length,
    syncedCount,
    failedCount,
    skippedCount,
  };
}

export async function retryGoogleCalendarSyncFailures() {
  await connectDB();
  const rows = await CalendarExternalEventSync.find({
    provider: GOOGLE_CALENDAR_PROVIDER,
    $or: [
      { pendingAction: { $in: ["upsert", "delete"] } },
      { lastError: { $exists: true, $ne: "" } },
    ],
  })
    .select("localEventId pendingAction")
    .lean<ILeanCalendarExternalEventSync[]>();

  let syncedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    const action = row.pendingAction ?? "upsert";
    const result = await syncEventToGoogle(String(row.localEventId), action);
    if (result.status === "synced") syncedCount++;
    if (result.status === "failed") failedCount++;
    if (result.status === "skipped") skippedCount++;
  }

  return {
    totalCount: rows.length,
    syncedCount,
    failedCount,
    skippedCount,
  };
}
