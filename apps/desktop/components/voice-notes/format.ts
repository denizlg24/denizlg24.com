const BYTE_UNITS = ["B", "KB", "MB", "GB"];

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  const rounded =
    value >= 100 || exponent === 0
      ? Math.round(value)
      : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} ${BYTE_UNITS[exponent]}`;
}

/** A total across many recordings: `5h12m`, `45m`, `38s`. */
export function formatSpan(milliseconds: number) {
  const totalSeconds = Math.round(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

/** A position inside one recording, padded so a column of them aligns. */
export function formatClock(seconds: number, withHours: boolean) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return withHours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${String(Math.floor(whole / 60)).padStart(2, "0")}:${rest}`;
}

export function formatTimeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function formatShortDate(iso: string) {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

export function formatDateTime(iso: string) {
  return `${formatShortDate(iso)} ${formatTimeOfDay(iso)}`;
}

export function formatTimeRange(start?: string, end?: string) {
  if (!start) return undefined;
  return end
    ? `${formatTimeOfDay(start)}–${formatTimeOfDay(end)}`
    : formatTimeOfDay(start);
}

/** Local calendar day, `yyyy-MM-dd`. */
export function localDayKey(iso: string) {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatDayHeading(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Lowercased, de-duplicated search terms; the server ANDs them. */
export function searchTerms(query: string) {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
}
