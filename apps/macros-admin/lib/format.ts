const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// UTC on purpose: the same string on the server and in the browser, so client
// components hydrate without a mismatch.
const absolute = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const dayMonth = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const integer = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

export function formatAbsolute(iso: string): string {
  return `${absolute.format(new Date(iso))} UTC`;
}

export function formatDate(iso: string): string {
  return dayMonthYear.format(new Date(iso));
}

/** `YYYY-MM-DD` → `3 Oct`. */
export function formatDay(day: string): string {
  return dayMonth.format(new Date(`${day}T00:00:00Z`));
}

export function formatRelative(iso: string, now: number): string {
  const time = new Date(iso).getTime();
  const elapsed = now - time;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  const sameYear =
    new Date(time).getUTCFullYear() === new Date(now).getUTCFullYear();
  return sameYear ? dayMonth.format(time) : dayMonthYear.format(time);
}

/** A duration as one unit: `42m`, `26h`, `3d`. */
export function formatAge(ms: number): string {
  if (ms < HOUR) return `${Math.max(0, Math.floor(ms / MINUTE))}m`;
  if (ms < 2 * DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

export function formatCount(value: number): string {
  return integer.format(value);
}

export function formatGrams(value: number): string {
  return value < 10 ? decimal.format(value) : integer.format(value);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

export const DAY_MS = DAY;
