import { TZDate } from "@date-fns/tz";
import { AppSettings, type ILeanAppSettings } from "@/models/AppSettings";
import { connectDB } from "./mongodb";

/**
 * All server-side day boundaries, day-of-week checks, date keys, and
 * human-readable timestamps must be computed in the user's timezone, not the
 * server's (Vercel runs in UTC). The timezone is a user setting stored in the
 * AppSettings singleton, falling back to the APP_TIMEZONE env var.
 *
 * TZDate is a Date subclass whose getters/setters operate in its timezone,
 * and date-fns v4 functions preserve it, so startOfDay(inTz(date, tz)) is the
 * user's midnight.
 */
export const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE ?? "Europe/Lisbon";

const CACHE_TTL_MS = 60_000;
let cachedTimeZone: { value: string; fetchedAt: number } | null = null;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export async function getAppTimeZone(): Promise<string> {
  if (cachedTimeZone && Date.now() - cachedTimeZone.fetchedAt < CACHE_TTL_MS) {
    return cachedTimeZone.value;
  }
  try {
    await connectDB();
    const settings = await AppSettings.findById("singleton")
      .lean<ILeanAppSettings>()
      .exec();
    const value =
      settings?.timeZone && isValidTimeZone(settings.timeZone)
        ? settings.timeZone
        : DEFAULT_TIMEZONE;
    cachedTimeZone = { value, fetchedAt: Date.now() };
    return value;
  } catch {
    return cachedTimeZone?.value ?? DEFAULT_TIMEZONE;
  }
}

/**
 * Sync accessor for serialization fallbacks that can't await. Returns the
 * last fetched value (any prior getAppTimeZone call warms it), falling back
 * to DEFAULT_TIMEZONE on a cold start.
 */
export function getCachedAppTimeZone(): string {
  return cachedTimeZone?.value ?? DEFAULT_TIMEZONE;
}

export async function setAppTimeZone(timeZone: string | null): Promise<string> {
  await connectDB();
  await AppSettings.findByIdAndUpdate(
    "singleton",
    { timeZone },
    { upsert: true },
  ).exec();
  cachedTimeZone = null;
  return getAppTimeZone();
}

export function inTz(date: Date | number | string, timeZone: string): TZDate {
  return new TZDate(new Date(date).getTime(), timeZone);
}

export function dateKeyInTz(
  date: Date | number | string,
  timeZone: string,
): string {
  const tzDate = inTz(date, timeZone);
  const month = String(tzDate.getMonth() + 1).padStart(2, "0");
  const day = String(tzDate.getDate()).padStart(2, "0");
  return `${tzDate.getFullYear()}-${month}-${day}`;
}
