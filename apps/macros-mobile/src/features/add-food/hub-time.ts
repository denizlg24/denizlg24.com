import { format, parseISO } from "date-fns";
import {
  eatenAtFor,
  followsClock,
  formatTimeOfDay,
  type LogTime,
} from "@/lib/log-time";
import { createStore, useStore } from "./store";

/**
 * When the add-food hub logs. The time sheet is its own route, so the choice
 * lives outside the hub's tree. Null follows the clock: today, now.
 */
const picked = createStore<LogTime | null>(null);

export const hubTime = {
  get: picked.get,
  set: (next: LogTime | null) => picked.set(next),
};

export function useHubTime(today: string): LogTime {
  return useStore(picked) ?? { date: today, clock: null };
}

/** The header chip: "Now", "6:00 AM", or "Sat 6:00 AM" for another day. */
export function hubTimeLabel(
  when: LogTime,
  timeZone: string,
  today: string,
  now: Date,
): string {
  if (followsClock(when, today)) return "Now";
  const time = formatTimeOfDay(eatenAtFor(when, timeZone, now), timeZone);
  return when.date === today
    ? time
    : `${format(parseISO(when.date), "EEE")} ${time}`;
}
