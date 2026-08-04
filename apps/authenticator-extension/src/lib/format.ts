const UNITS: [limitSeconds: number, divisor: number, suffix: string][] = [
  [60, 1, "s"],
  [3600, 60, "m"],
  [86400, 3600, "h"],
  [Number.POSITIVE_INFINITY, 86400, "d"],
];

/** "3m", "2h", "never" — terse enough for a 380px header. */
export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";

  const seconds = Math.max(
    0,
    Math.floor((now - new Date(iso).getTime()) / 1000),
  );
  if (seconds < 5) return "just now";

  for (const [limit, divisor, suffix] of UNITS) {
    if (seconds < limit) return `${Math.floor(seconds / divisor)}${suffix}`;
  }

  return "never";
}
