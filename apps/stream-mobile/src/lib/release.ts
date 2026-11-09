const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface ReleaseNote {
  /** "Nov" beside a card. */
  month: string;
  day: string;
  /** "Coming 14 November", "Out since 3 November". */
  text: string;
}

const RECENT_DAYS = 90;

/**
 * The date column and line on New & Popular, for titles out recently or
 * still to come; null for anything older, which needs no date.
 */
export function releaseNote(
  isoDate: string | null,
  today: Date = new Date(),
): ReleaseNote | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const release = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((release - now) / 86_400_000);
  if (days < -RECENT_DAYS) return null;
  const name = MONTHS[m - 1] ?? "";
  const sameYear = y === today.getFullYear();
  const when = `${d} ${name}${sameYear ? "" : ` ${y}`}`;
  return {
    month: name.slice(0, 3),
    day: String(d),
    text:
      days > 0
        ? `Coming ${when}`
        : days === 0
          ? "Out today"
          : `Out since ${when}`,
  };
}
