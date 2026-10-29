/**
 * Timeline dates are stored as typed, usually `MM-DD-YYYY`. WebKit (the
 * desktop app's web view) refuses that shape in `new Date()`, so it is parsed
 * by hand before falling back to the engine.
 */
export function parseTimelineDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(trimmed);
  const date = match
    ? new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]))
    : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMonth(value: string): string {
  const date = parseTimelineDate(value);
  return date
    ? date.toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : value;
}

export function formatTimelineRange(from: string, to?: string): string {
  return `${formatMonth(from)} — ${to?.trim() ? formatMonth(to) : "Present"}`;
}
