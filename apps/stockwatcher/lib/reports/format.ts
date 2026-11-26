import type { AxisFormat } from "./chart";

const minus = "−";

function currencyPrefix(code: string) {
  if (code === "GBp") return "";
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? "";
  } catch {
    return "";
  }
}

const suffixFor = (axis: AxisFormat) =>
  axis.format === "percent"
    ? "%"
    : axis.format === "currency" && axis.currency === "GBp"
      ? "p"
      : axis.format === "number" && axis.unit
        ? axis.unit.length <= 2
          ? axis.unit
          : ` ${axis.unit}`
        : "";

export function formatValue(
  value: number | null | undefined,
  axis: AxisFormat,
  options: { signed?: boolean; compact?: boolean; decimals?: number } = {},
) {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const decimals =
    options.decimals ??
    axis.decimals ??
    (axis.format === "percent" ? 1 : abs >= 1000 ? 0 : 2);
  const body = new Intl.NumberFormat("en-US", {
    notation: options.compact && abs >= 10_000 ? "compact" : "standard",
    minimumFractionDigits: options.compact && abs >= 10_000 ? 0 : decimals,
    maximumFractionDigits: decimals,
  }).format(abs);
  const sign =
    value < 0 && Number(body.replace(/[^\d.]/g, "")) !== 0
      ? minus
      : options.signed && value > 0
        ? "+"
        : "";
  const prefix =
    axis.format === "currency" && axis.currency
      ? currencyPrefix(axis.currency)
      : "";
  return `${sign}${prefix}${body}${suffixFor(axis)}`;
}

export function axisCaption(axis: AxisFormat) {
  if (axis.label) return axis.label;
  if (axis.format === "percent") return "%";
  if (axis.format === "currency") return axis.currency ?? "";
  return axis.unit ?? "";
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ??
    10 * magnitude;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step)
    ticks.push(Number(value.toFixed(10)));
  return ticks;
}

const day = 86_400_000;

export function timeTicks(min: number, max: number, target = 6): number[] {
  const span = max - min;
  if (span <= 3 * day) {
    const hours =
      [1, 2, 3, 6, 12, 24].find((h) => span / (h * 3_600_000) <= target) ?? 24;
    const step = hours * 3_600_000;
    const ticks: number[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step)
      ticks.push(t);
    return ticks;
  }
  if (span <= 45 * day) {
    const days = [1, 2, 7, 14].find((d) => span / (d * day) <= target) ?? 14;
    const ticks: number[] = [];
    const start = new Date(min);
    start.setUTCHours(0, 0, 0, 0);
    if (days >= 7) {
      while (start.getUTCDay() !== 1) start.setUTCDate(start.getUTCDate() + 1);
    }
    for (let t = start.getTime(); t <= max; t += days * day)
      if (t >= min) ticks.push(t);
    return ticks;
  }
  const months =
    [1, 2, 3, 4, 6, 12, 24, 60].find(
      (m) => span / (m * 30.44 * day) <= target,
    ) ?? 60;
  const ticks: number[] = [];
  const cursor = new Date(min);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  const step = months;
  while (
    cursor.getTime() < min ||
    (step >= 12
      ? cursor.getUTCMonth() !== 0
      : cursor.getUTCMonth() % step !== 0)
  )
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= max) {
    ticks.push(cursor.getTime());
    cursor.setUTCMonth(cursor.getUTCMonth() + step);
  }
  return ticks;
}

export function timeTickLabel(value: number, span: number, first: boolean) {
  const date = new Date(value);
  if (span <= 3 * day)
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(date);
  if (span <= 45 * day)
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(date);
  if (span > 3 * 365 * day) return String(date.getUTCFullYear());
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return first || date.getUTCMonth() === 0
    ? `${month} ${date.getUTCFullYear()}`
    : month;
}

export function longDate(value: number, withTime: boolean) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "UTC",
  }).format(value);
}

export function editionDate(iso: string) {
  const time = Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (!Number.isFinite(time)) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(time);
}

export function asOfLabel(iso: string) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  const dateOnly = iso.length === 10;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
    timeZone: "UTC",
  })
    .format(time)
    .concat(dateOnly ? "" : " UTC");
}

export const parseTime = (value: string | number) =>
  typeof value === "number"
    ? value
    : Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
