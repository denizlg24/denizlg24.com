const stampFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const secondsFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
});
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function utcStamp(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : stampFormat.format(date);
}

export function utcClock(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : secondsFormat.format(date);
}

export function duration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export const count = (value: number | null) =>
  value == null ? "—" : whole.format(value);

export function tokens(input: number | null, output: number | null) {
  if (input == null && output == null) return "—";
  return `${count(input)} / ${count(output)}`;
}

export const percentOf = (part: number, total: number) =>
  total ? `${((part / total) * 100).toFixed(1)}%` : "—";
