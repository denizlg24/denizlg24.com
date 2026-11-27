import { conditionMet, reading } from "@/lib/alerts";
import type { AlertEvent, AlertRule, Quote } from "@/lib/models";
import { compact, percent } from "@/lib/utils";

export function ago(iso: string | null, now = Date.now()) {
  if (!iso) return "never";
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const day = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dayWithYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const stamp = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const clockTime = (iso: string) => clock.format(Date.parse(iso));
export const fullTime = (iso: string) => stamp.format(Date.parse(iso));

const localDay = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

export function dayLabel(iso: string, now = Date.now()) {
  const time = Date.parse(iso);
  if (localDay(time) === localDay(now)) return "Today";
  if (localDay(time) === localDay(now - 86_400_000)) return "Yesterday";
  return new Date(time).getFullYear() === new Date(now).getFullYear()
    ? day.format(time)
    : dayWithYear.format(time);
}

export type Distance = {
  met: boolean;
  /** Plain-language gap, e.g. "+2.31% to go". */
  text: string;
  /** 0 far away … 1 at the trigger. */
  closeness: number;
};

const scale = 10;

/** How far the live reading is from setting the alert off. */
export function distance(
  rule: AlertRule,
  quote: Pick<Quote, "price" | "percent" | "volume"> | undefined,
): Distance | null {
  const value = reading(rule, quote);
  if (value == null) return null;
  if (conditionMet(rule, value))
    return { met: true, text: "Condition met", closeness: 1 };
  if (rule.metric === "volume")
    return {
      met: false,
      text: `${compact(rule.target - value)} to go`,
      closeness: rule.target
        ? Math.max(0, Math.min(1, value / rule.target))
        : 0,
    };
  if (rule.metric === "price") {
    const gap = value ? (rule.target / value - 1) * 100 : 0;
    return {
      met: false,
      text: `${percent(gap)} to go`,
      closeness: Math.max(0, 1 - Math.abs(gap) / scale),
    };
  }
  const points = rule.target - value;
  return {
    met: false,
    text: `${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(2)} pts to go`,
    closeness: Math.max(0, 1 - Math.abs(points) / scale),
  };
}

/** An alert this close counts as "close to triggering" in the summary. */
export const nearCloseness = 0.8;

/** Latest event per alert id; the log is newest first. */
export function latestEvents(log: AlertEvent[]) {
  const latest = new Map<string, AlertEvent>();
  for (const event of log)
    if (!latest.has(event.alertId)) latest.set(event.alertId, event);
  return latest;
}
