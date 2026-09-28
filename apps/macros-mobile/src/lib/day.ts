import { addDays, format, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { getCalendars } from "expo-localization";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

export function deviceTimeZone(): string {
  return getCalendars()[0]?.timeZone ?? "UTC";
}

/** Today as `yyyy-MM-dd` in the given zone — the server's notion of a day. */
export function isoToday(timeZone: string = deviceTimeZone()): string {
  return formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
}

export function shiftIsoDate(isoDate: string, days: number): string {
  return format(addDays(parseISO(isoDate), days), "yyyy-MM-dd");
}

function msUntilNextMidnight(timeZone: string): number {
  const now = new Date();
  const hours = Number(formatInTimeZone(now, timeZone, "H"));
  const minutes = Number(formatInTimeZone(now, timeZone, "m"));
  const seconds = Number(formatInTimeZone(now, timeZone, "s"));
  const elapsed = ((hours * 60 + minutes) * 60 + seconds) * 1000;
  return Math.max(1000, 24 * 60 * 60 * 1000 - elapsed + 500);
}

/**
 * The current day, re-rendering at midnight and whenever the app returns to
 * the foreground — a phone left on the counter overnight must not keep
 * logging into yesterday.
 */
export function useToday(timeZone: string = deviceTimeZone()): string {
  const [today, setToday] = useState(() => isoToday(timeZone));

  useEffect(() => {
    setToday(isoToday(timeZone));
    let timer = setTimeout(function tick() {
      setToday(isoToday(timeZone));
      timer = setTimeout(tick, msUntilNextMidnight(timeZone));
    }, msUntilNextMidnight(timeZone));
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") setToday(isoToday(timeZone));
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [timeZone]);

  return today;
}

function msUntilNextMinute(): number {
  return 60_000 - (Date.now() % 60_000) + 50;
}

/**
 * The current time, re-rendering as each minute turns while `active` — for a
 * picker that shows "now" and must not sit on a stale minute.
 */
export function useCurrentMinute(active = true): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    let timer = setTimeout(function tick() {
      setNow(new Date());
      timer = setTimeout(tick, msUntilNextMinute());
    }, msUntilNextMinute());
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") setNow(new Date());
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [active]);

  return now;
}
