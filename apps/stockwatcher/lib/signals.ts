import type { Signal, SignalCadence, SignalRuntime } from "./models";

export const maxConsecutiveErrors = 5;

export const cadenceLabels: Record<SignalCadence, string> = {
  tick: "Every check (~2 min)",
  hourly: "Hourly",
  daily: "Daily after US close",
};

const HOUR_MS = 60 * 60_000;
const CLOSE_MINUTE = 16 * 60 + 30;
const newYork = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** The latest 16:30 New York weekday close at or before `now`, as epoch ms, or null before the first one this week. */
function lastCloseCheck(now: Date): number | null {
  for (let back = 0; back < 4; back++) {
    const day = new Date(now.getTime() - back * 24 * HOUR_MS);
    const parts = Object.fromEntries(
      newYork.formatToParts(day).map((part) => [part.type, part.value]),
    );
    if (parts.weekday === "Sat" || parts.weekday === "Sun") continue;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    const sinceClose =
      (minutes - CLOSE_MINUTE) * 60_000 + Number(parts.second) * 1000;
    if (back === 0 && sinceClose < 0) continue;
    return day.getTime() - sinceClose;
  }
  return null;
}

export function isDue(
  signal: Pick<Signal, "enabled" | "cadence" | "lastChecked">,
  now = new Date(),
) {
  if (!signal.enabled) return false;
  if (signal.lastChecked === null) return true;
  const last = Date.parse(signal.lastChecked);
  switch (signal.cadence) {
    case "tick":
      return true;
    case "hourly":
      return now.getTime() - last >= HOUR_MS;
    case "daily": {
      const close = lastCloseCheck(now);
      return close !== null && last < close;
    }
  }
}

export type SignalReading = {
  trigger: boolean;
  value: number | null;
  message: string | null;
};

/** Normalises what a signal script returned: a boolean or `{ trigger, value?, message? }`. */
export function interpret(
  result: unknown,
): { ok: true; reading: SignalReading } | { ok: false; error: string } {
  if (typeof result === "boolean")
    return {
      ok: true,
      reading: { trigger: result, value: null, message: null },
    };
  if (typeof result === "object" && result !== null && "trigger" in result) {
    const { trigger } = result;
    if (typeof trigger !== "boolean")
      return { ok: false, error: "`trigger` must be true or false." };
    const value =
      "value" in result &&
      typeof result.value === "number" &&
      Number.isFinite(result.value)
        ? result.value
        : null;
    const message =
      "message" in result && typeof result.message === "string"
        ? result.message.trim().slice(0, 300) || null
        : null;
    return { ok: true, reading: { trigger, value, message } };
  }
  return {
    ok: false,
    error:
      "Return true/false or { trigger: boolean, value?: number, message?: string }.",
  };
}

export type SignalRun =
  | { ok: true; reading: SignalReading }
  | { ok: false; error: string };

/** `owned` is true when a user-owned field changed and the workspace must be saved. */
export type SignalStep = { fired: boolean; disabled: boolean; owned: boolean };

export const blankRuntime: SignalRuntime = {
  lastValue: null,
  lastMessage: null,
  lastChecked: null,
  lastError: null,
  errorCount: 0,
};

export const runtimeOf = (signal: Signal): SignalRuntime => ({
  lastValue: signal.lastValue,
  lastMessage: signal.lastMessage,
  lastChecked: signal.lastChecked,
  lastError: signal.lastError,
  errorCount: signal.errorCount,
});

export const withRuntime = (
  signals: Signal[],
  runtime: Map<string, SignalRuntime>,
): Signal[] =>
  signals.map((signal) => ({
    ...signal,
    ...(runtime.get(signal.id) ?? blankRuntime),
  }));

/**
 * Records one run on a signal carrying its runtime state: bookkeeping,
 * priming, repeat mode and error disabling.
 */
export function applyRun(
  signal: Signal,
  run: SignalRun,
  now = new Date(),
): SignalStep {
  const before = [signal.enabled, signal.primed, signal.triggerCount];
  const step = record(signal, run, now);
  const owned =
    step.fired ||
    step.disabled ||
    before[0] !== signal.enabled ||
    before[1] !== signal.primed ||
    before[2] !== signal.triggerCount;
  return { ...step, owned };
}

function record(
  signal: Signal,
  run: SignalRun,
  now: Date,
): { fired: boolean; disabled: boolean } {
  signal.lastChecked = now.toISOString();
  if (!run.ok) {
    signal.errorCount += 1;
    signal.lastError = run.error.slice(0, 300);
    const disabled = signal.errorCount >= maxConsecutiveErrors;
    if (disabled) signal.enabled = false;
    return { fired: false, disabled };
  }
  const { trigger, value, message } = run.reading;
  signal.errorCount = 0;
  signal.lastError = null;
  signal.lastValue = value;
  signal.lastMessage = message;
  if (!signal.primed) {
    if (!trigger) signal.primed = true;
    return { fired: false, disabled: false };
  }
  if (!trigger) return { fired: false, disabled: false };
  signal.lastTriggered = now.toISOString();
  signal.triggerCount += 1;
  if (signal.repeat === "once") signal.enabled = false;
  else signal.primed = false;
  return { fired: true, disabled: false };
}

export function describeSignal(
  signal: Pick<Signal, "name" | "cadence" | "repeat">,
) {
  return `${signal.name} · ${cadenceLabels[signal.cadence].toLowerCase()}${signal.repeat === "rearm" ? " · re-arms" : ""}`;
}

export function signalStatus(
  signal: Pick<Signal, "enabled" | "primed" | "lastError" | "lastTriggered">,
) {
  if (signal.enabled) return signal.primed ? "Armed" : "Waiting to reset";
  if (signal.lastError) return "Errored";
  return signal.lastTriggered ? "Triggered" : "Paused";
}
