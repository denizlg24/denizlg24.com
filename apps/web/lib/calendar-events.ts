import { endOfDay, startOfDay } from "date-fns";
import { observeDomainRecordSafely } from "@/lib/agent-memory/domain-evidence";
import {
  CalendarEvent,
  type ICalendarEvent,
  type ILeanCalendarEvent,
} from "@/models/CalendarEvent";
import { connectDB } from "./mongodb";
import {
  dateKeyInTz,
  getAppTimeZone,
  getCachedAppTimeZone,
  inTz,
} from "./timezone";

type CalendarEventInput = Partial<ILeanCalendarEvent> & {
  date?: Date | string;
};

const GENERATED_EDIT_FIELDS = new Set([
  "date",
  "calendarDate",
  "endDate",
  "isAllDay",
  "title",
  "place",
  "links",
  "status",
  "notifyBySlack",
  "notifyBeforeMinutes",
]);

export function calendarDateFromDate(
  date: Date | string,
  timeZone: string = getCachedAppTimeZone(),
) {
  return dateKeyInTz(date, timeZone);
}

export function anchorDateFromCalendarDate(calendarDate: string) {
  return new Date(`${calendarDate}T12:00:00.000Z`);
}

export function normalizeCalendarEventInput(
  data: CalendarEventInput,
  timeZone: string = getCachedAppTimeZone(),
) {
  const kind = data.kind ?? "manual";
  const isAllDay = data.isAllDay ?? false;
  const calendarDate =
    data.calendarDate ??
    (data.date
      ? calendarDateFromDate(data.date, timeZone)
      : calendarDateFromDate(new Date(), timeZone));
  const date = data.date
    ? new Date(data.date)
    : isAllDay
      ? anchorDateFromCalendarDate(calendarDate)
      : new Date();

  return {
    ...data,
    kind,
    isAllDay,
    calendarDate,
    date: isAllDay ? anchorDateFromCalendarDate(calendarDate) : date,
    ...(data.endDate !== undefined
      ? { endDate: data.endDate ? new Date(data.endDate) : undefined }
      : {}),
    links: data.links ?? [],
    status: data.status ?? "scheduled",
    notifyBySlack: data.notifyBySlack ?? false,
    isNotificationSent: data.isNotificationSent ?? false,
    notifyBeforeMinutes: data.notifyBeforeMinutes ?? 15,
  };
}

export function serializeCalendarEvent(
  event: ICalendarEvent | Record<string, unknown>,
): ILeanCalendarEvent {
  const source = event.source as ILeanCalendarEvent["source"] | undefined;
  const date = event.date as Date;
  const calendarDate =
    (event.calendarDate as string | undefined) ?? calendarDateFromDate(date);

  return {
    ...(event as ILeanCalendarEvent),
    _id: String(event._id),
    date,
    endDate: event.endDate as Date | undefined,
    calendarDate,
    isAllDay: (event.isAllDay as boolean | undefined) ?? false,
    kind: (event.kind as ILeanCalendarEvent["kind"] | undefined) ?? "manual",
    source: source
      ? {
          ...source,
          personId: source.personId ? String(source.personId) : undefined,
          isCustomized: source.isCustomized ?? false,
          isSuppressed: source.isSuppressed ?? false,
        }
      : undefined,
    links: ((event.links as ILeanCalendarEvent["links"] | undefined) ?? []).map(
      (link) => ({
        ...link,
        _id: String(link._id),
      }),
    ),
    status:
      (event.status as ILeanCalendarEvent["status"] | undefined) ?? "scheduled",
    notifyBySlack: (event.notifyBySlack as boolean | undefined) ?? false,
    isNotificationSent:
      (event.isNotificationSent as boolean | undefined) ?? false,
    notifyBeforeMinutes:
      (event.notifyBeforeMinutes as number | undefined) ?? 15,
  };
}

function visibleCalendarFilter() {
  return {
    $or: [
      { "source.isSuppressed": { $ne: true } },
      { source: { $exists: false } },
    ],
  };
}

export const getMonthCalendarEvents = async (start: Date, end: Date) => {
  try {
    await connectDB();
    const timeZone = await getAppTimeZone();
    const startDate = calendarDateFromDate(start, timeZone);
    const endDate = calendarDateFromDate(end, timeZone);
    const events = await CalendarEvent.find({
      $and: [
        visibleCalendarFilter(),
        {
          $or: [
            { date: { $gte: start, $lte: end } },
            { calendarDate: { $gte: startDate, $lte: endDate } },
          ],
        },
      ],
    })
      .sort({ calendarDate: 1, isAllDay: -1, date: 1 })
      .lean();

    return events.map(serializeCalendarEvent);
  } catch {
    return [];
  }
};

export const getCalendarEvents = async (date: Date) => {
  try {
    await connectDB();
    const timeZone = await getAppTimeZone();
    const calendarDate = calendarDateFromDate(date, timeZone);
    const tzDate = inTz(date, timeZone);
    const events = await CalendarEvent.find({
      $and: [
        visibleCalendarFilter(),
        {
          $or: [
            { date: { $gte: startOfDay(tzDate), $lte: endOfDay(tzDate) } },
            { calendarDate },
          ],
        },
      ],
    })
      .sort({ isAllDay: -1, date: 1 })
      .lean();

    return events.map(serializeCalendarEvent);
  } catch {
    return [];
  }
};

export const updateCalendarEvent = async ({
  id,
  data,
}: {
  id: string;
  data: CalendarEventInput;
}) => {
  try {
    await connectDB();
    const timeZone = await getAppTimeZone();

    const existing = await CalendarEvent.findById(id).lean();
    if (!existing) return null;

    const update = { ...data };
    if (!existing.calendarDate) {
      update.calendarDate = calendarDateFromDate(existing.date, timeZone);
    }
    if (existing.isAllDay === undefined && update.isAllDay === undefined) {
      update.isAllDay = false;
    }
    if (!existing.kind && !update.kind) {
      update.kind = "manual";
    }
    if (
      update.date !== undefined ||
      update.calendarDate !== undefined ||
      update.isAllDay !== undefined ||
      update.endDate !== undefined
    ) {
      Object.assign(
        update,
        normalizeCalendarEventInput(
          {
            date: update.date ?? existing.date,
            calendarDate: update.calendarDate ?? existing.calendarDate,
            isAllDay: update.isAllDay ?? existing.isAllDay,
            kind: update.kind ?? existing.kind,
            source: existing.source as ILeanCalendarEvent["source"],
          },
          timeZone,
        ),
      );
    }

    if (existing.source && hasGeneratedUserEdit(update)) {
      update.source = {
        ...(existing.source as NonNullable<ILeanCalendarEvent["source"]>),
        ...(update.source ?? {}),
        isCustomized: true,
      };
    }

    const unset: Record<string, ""> = {};
    const notificationFieldsChanged =
      update.notifyBySlack !== undefined ||
      update.date !== undefined ||
      update.notifyBeforeMinutes !== undefined;
    const nextNotifyBySlack =
      update.notifyBySlack ?? existing.notifyBySlack ?? false;
    const nextEventDate = new Date(update.date ?? existing.date);
    const notificationScheduleChanged =
      (update.notifyBySlack !== undefined &&
        update.notifyBySlack !== existing.notifyBySlack) ||
      (update.notifyBeforeMinutes !== undefined &&
        update.notifyBeforeMinutes !== (existing.notifyBeforeMinutes ?? 15)) ||
      (update.date !== undefined &&
        nextEventDate.getTime() !== new Date(existing.date).getTime());

    if (notificationFieldsChanged && nextNotifyBySlack) {
      const notifyBeforeMinutes =
        update.notifyBeforeMinutes ?? existing.notifyBeforeMinutes ?? 15;
      update.notifyAt = new Date(
        nextEventDate.getTime() - notifyBeforeMinutes * 60_000,
      );
      if (notificationScheduleChanged) {
        update.isNotificationSent = false;
      }
    } else if (update.notifyBySlack === false) {
      unset.notifyAt = "";
      update.isNotificationSent = false;
    }

    const updateOperation =
      Object.keys(unset).length > 0 ? { $set: update, $unset: unset } : update;

    const updatedEvent = await CalendarEvent.findByIdAndUpdate(
      id,
      updateOperation,
      {
        returnDocument: "after",
      },
    ).lean();

    if (!updatedEvent) return null;
    await observeDomainRecordSafely("calendar", updatedEvent);
    return serializeCalendarEvent(updatedEvent);
  } catch {
    return null;
  }
};

export const deleteCalendarEvent = async (id: string) => {
  try {
    await connectDB();
    const event = await CalendarEvent.findById(id).lean();
    if (!event) return false;

    if (event.source) {
      await CalendarEvent.findByIdAndUpdate(id, {
        $set: {
          "source.isSuppressed": true,
          "source.isCustomized": true,
        },
      });
      return true;
    }

    await CalendarEvent.findByIdAndDelete(id);
    return true;
  } catch {
    return false;
  }
};

export const createCalendarEvent = async (data: CalendarEventInput) => {
  try {
    await connectDB();
    const normalized = normalizeCalendarEventInput(
      data,
      await getAppTimeZone(),
    );

    if (
      normalized.notifyBySlack &&
      normalized.date &&
      normalized.notifyBeforeMinutes !== undefined
    ) {
      normalized.notifyAt = new Date(
        new Date(normalized.date).getTime() -
          normalized.notifyBeforeMinutes * 60_000,
      );
    }

    const savedEvent = await CalendarEvent.create(normalized);
    await observeDomainRecordSafely("calendar", savedEvent.toObject());
    return serializeCalendarEvent(savedEvent.toObject());
  } catch (err) {
    console.log(err);
    return null;
  }
};

function hasGeneratedUserEdit(data: CalendarEventInput) {
  return Object.keys(data).some((key) => GENERATED_EDIT_FIELDS.has(key));
}
