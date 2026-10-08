import { format } from "date-fns";

/** Wall-clock helpers: shifts are entered as times on the phone, where they happened. */

export function localDay(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function localTime(date: Date) {
  return format(date, "HH:mm");
}

export function combine(day: string, time: Date | string) {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] =
    typeof time === "string"
      ? time.split(":").map(Number)
      : [time.getHours(), time.getMinutes()];
  return new Date(
    year ?? 1970,
    (month ?? 1) - 1,
    date ?? 1,
    hours ?? 0,
    minutes ?? 0,
  );
}

/** A time on the shift's day, rolled past midnight when it reads earlier than the start. */
export function onShift(day: string, time: Date, start: Date) {
  const value = combine(day, time);
  if (value < start) value.setDate(value.getDate() + 1);
  return value;
}

export function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDay(date);
}

export function clockface(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
