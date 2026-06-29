"use client";

import type {
  ICalendarEvent,
  ICalendarGoogleIntegrationStatus,
} from "@repo/schemas";
import type { AdminClient } from "../client";

const calendarEventsCache = new Map<string, ICalendarEvent[]>();
const calendarEventRequests = new Map<string, Promise<ICalendarEvent[]>>();
let googleStatusCache: ICalendarGoogleIntegrationStatus | undefined;
let googleStatusRequest: Promise<ICalendarGoogleIntegrationStatus> | null =
  null;

export function getCalendarMonthRange(
  date = new Date(),
  monthOffset = 0,
): { start: Date; end: Date } {
  const year = date.getFullYear();
  const month = date.getMonth() + monthOffset;

  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 0, 23, 59, 59),
  };
}

export function getCalendarCacheKey(start: Date, end: Date) {
  return `${start.toISOString()}|${end.toISOString()}`;
}

export function getCachedCalendarEvents(start: Date, end: Date) {
  return calendarEventsCache.get(getCalendarCacheKey(start, end)) ?? null;
}

export function setCachedCalendarEvents(
  start: Date,
  end: Date,
  events: ICalendarEvent[],
) {
  calendarEventsCache.set(getCalendarCacheKey(start, end), events);
}

export function deleteCachedCalendarEvents(start: Date, end: Date) {
  calendarEventsCache.delete(getCalendarCacheKey(start, end));
}

export function replaceCachedCalendarEvent(event: ICalendarEvent) {
  for (const [key, events] of calendarEventsCache.entries()) {
    if (!events.some((cachedEvent) => cachedEvent._id === event._id)) {
      continue;
    }

    calendarEventsCache.set(
      key,
      events.map((cachedEvent) =>
        cachedEvent._id === event._id ? event : cachedEvent,
      ),
    );
  }
}

export function removeCachedCalendarEvent(eventId: string) {
  for (const [key, events] of calendarEventsCache.entries()) {
    const nextEvents = events.filter((event) => event._id !== eventId);
    if (nextEvents.length !== events.length) {
      calendarEventsCache.set(key, nextEvents);
    }
  }
}

export function getCachedGoogleCalendarStatus() {
  return googleStatusCache ?? null;
}

export function setCachedGoogleCalendarStatus(
  status: ICalendarGoogleIntegrationStatus,
) {
  googleStatusCache = status;
}

export async function fetchCalendarEvents(
  client: AdminClient,
  start: Date,
  end: Date,
  options: { signal?: AbortSignal; skipCache?: boolean } = {},
) {
  const key = getCalendarCacheKey(start, end);
  const cachedEvents = calendarEventsCache.get(key);

  if (!options.skipCache && cachedEvents) {
    return cachedEvents;
  }

  const pendingRequest = calendarEventRequests.get(key);
  if (!options.skipCache && pendingRequest) {
    return pendingRequest;
  }

  const request = client
    .get<{ events: ICalendarEvent[] }>(
      `calendar?start=${start.toISOString()}&end=${end.toISOString()}`,
      { signal: options.signal },
    )
    .then((result) => {
      calendarEventsCache.set(key, result.events);
      return result.events;
    })
    .finally(() => {
      calendarEventRequests.delete(key);
    });

  if (!options.signal && !options.skipCache) {
    calendarEventRequests.set(key, request);
  }

  return request;
}

export async function fetchGoogleCalendarStatus(
  client: AdminClient,
  options: { signal?: AbortSignal; skipCache?: boolean } = {},
) {
  if (!options.skipCache && googleStatusCache !== undefined) {
    return googleStatusCache;
  }

  if (!options.skipCache && googleStatusRequest) {
    return googleStatusRequest;
  }

  const request = client
    .get<ICalendarGoogleIntegrationStatus>("calendar/google", {
      signal: options.signal,
    })
    .then((status) => {
      googleStatusCache = status;
      return status;
    })
    .finally(() => {
      googleStatusRequest = null;
    });

  if (!options.signal && !options.skipCache) {
    googleStatusRequest = request;
  }

  return request;
}

export async function preloadInitialCalendarData(client: AdminClient) {
  const currentMonth = getCalendarMonthRange();

  await Promise.allSettled([
    fetchCalendarEvents(client, currentMonth.start, currentMonth.end),
    fetchGoogleCalendarStatus(client),
  ]);

  const previousMonth = getCalendarMonthRange(currentMonth.start, -1);
  const nextMonth = getCalendarMonthRange(currentMonth.start, 1);

  await Promise.allSettled([
    fetchCalendarEvents(client, previousMonth.start, previousMonth.end),
    fetchCalendarEvents(client, nextMonth.start, nextMonth.end),
  ]);
}
