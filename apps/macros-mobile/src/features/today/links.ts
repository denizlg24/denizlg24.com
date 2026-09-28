import type { Href } from "expo-router";
import type { LogTimeParams } from "@/lib/log-time";

/**
 * The weigh-in sheet. Pass a `yyyy-MM-dd` date to edit that day — the sheet
 * prefills whatever was logged then; omit it for today.
 */
export function weighInHref(date?: string): Href {
  return date ? { pathname: "/weigh-in", params: { date } } : "/weigh-in";
}

/**
 * The quick add sheet. Logs to today at the moment of logging unless a day
 * (`yyyy-MM-dd`, not after today) or a time (`HH:mm`) is given.
 */
export function quickAddHref(options: LogTimeParams = {}): Href {
  const params: Record<string, string> = {};
  if (options.date) params.date = options.date;
  if (options.time) params.time = options.time;
  return Object.keys(params).length > 0
    ? { pathname: "/quick-add", params }
    : "/quick-add";
}
