/** Terse renderings shared by every screen; pure so they can be tested. */

const pad = (value: number) => String(value).padStart(2, "0");

/** `09:05`, local time. */
export function clock(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const DAY_MS = 86_400_000;

/** Whole local days from `now` to `value`; negative in the past. */
export function daysFrom(value: string | Date, now = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  return Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS,
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Today", "Tomorrow", "Yesterday", "Thu" within a week, else "14 Oct". */
export function dayLabel(value: string | Date, now = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  const days = daysFrom(date, now);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return WEEKDAYS[date.getDay()] ?? "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "now", "4 min ago", "3 h ago", "2 d ago". */
export function ago(value: string, now = Date.now()) {
  const seconds = Math.max(0, (now - new Date(value).getTime()) / 1_000);
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** "in 40 min", "in 3 h", "in 2 d", or `ago` once it has passed. */
export function until(value: string, now = Date.now()) {
  const seconds = (new Date(value).getTime() - now) / 1_000;
  if (seconds < 0) return ago(value, now);
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} d`;
}

/** `yyyy-MM-dd` for a local date. */
export function isoDay(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
