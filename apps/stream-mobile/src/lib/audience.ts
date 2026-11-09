import type { Profile } from "@repo/schemas/stream";

/**
 * Who is watching. Pure, so the rules are tested: the stored ids are kept
 * only while those profiles exist, in the order they were picked, and an
 * account with one profile never sees "Who's watching?". The first profile
 * leads: the per-profile routes (progress, the list, the title page) use it.
 * A profile's `layout` is only a text size now, so it never limits who can
 * watch together.
 */
export function resolveAudience(
  profiles: Profile[],
  stored: string[] | null,
): Profile[] {
  const only = profiles.length === 1 ? profiles[0] : undefined;
  if (only) return [only];
  return (stored ?? [])
    .map((id) => profiles.find((profile) => profile.id === id))
    .filter((profile): profile is Profile => profile !== undefined);
}

export interface SofaChange {
  selection: string[];
  /** True when the tap should start watching straight away. */
  start: boolean;
}

/** Tapping a profile while picking several people to watch together. */
export function toggleSofa(
  selection: string[],
  profile: Profile,
  profiles: Profile[],
): SofaChange {
  const known = selection.filter((id) => profiles.some((p) => p.id === id));
  return known.includes(profile.id)
    ? { selection: known.filter((id) => id !== profile.id), start: false }
    : { selection: [...known, profile.id], start: false };
}

/** "Deniz", "Deniz & Mum", "Deniz, Mum & Ana". */
export function audienceNames(audience: Pick<Profile, "name">[]): string {
  const names = audience.map((profile) => profile.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
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

/** `2026-10-23` → "Friday 23 October", read as a calendar day, not an instant. */
export function editionDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[date.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}
