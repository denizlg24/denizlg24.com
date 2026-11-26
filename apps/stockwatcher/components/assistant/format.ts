import { useSyncExternalStore } from "react";

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((notify) => notify());
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useNow() {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});
const shortDateYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

export function ago(
  time: number | string | null | undefined,
  reference: number,
) {
  if (time == null || !reference) return "";
  const ms = typeof time === "number" ? time : Date.parse(time);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const seconds = Math.round((ms - reference) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400)
    return relative.format(Math.round(seconds / 86_400), "day");
  const date = new Date(ms);
  return new Date(reference).getFullYear() === date.getFullYear()
    ? shortDate.format(date)
    : shortDateYear.format(date);
}

export function stamp(time: number | string | null | undefined) {
  if (time == null) return "";
  const ms = typeof time === "number" ? time : Date.parse(time);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const date = new Date(ms);
  return `${shortDate.format(date)} ${clock.format(date)}`;
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function listSymbols(
  symbols: readonly (string | undefined)[] | undefined,
) {
  const clean = (symbols ?? []).filter((symbol): symbol is string =>
    Boolean(symbol),
  );
  if (!clean.length) return "";
  return clean.length > 4
    ? `${clean.slice(0, 3).join(", ")} +${clean.length - 3}`
    : clean.join(", ");
}

export function errorMessage(error: Error | undefined) {
  if (!error) return "";
  try {
    const parsed: unknown = JSON.parse(error.message);
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof parsed.error === "string"
    )
      return parsed.error;
  } catch {}
  return error.message || "The assistant could not respond.";
}
