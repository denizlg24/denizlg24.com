import type { Profile } from "@repo/schemas/stream";

/**
 * Who is on the sofa. Pure, so the rules are tested: the stored ids are kept
 * only while those profiles exist, an account with one profile never sees
 * the sofa, and a classic profile always watches alone (its sofa is
 * single-select). The first profile leads: its layout is the app's, and the
 * per-profile routes (progress, the list, the title page) use it.
 */
export function resolveAudience(
  profiles: Profile[],
  stored: string[] | null,
): Profile[] {
  const only = profiles.length === 1 ? profiles[0] : undefined;
  if (only) return [only];
  const chosen = (stored ?? [])
    .map((id) => profiles.find((profile) => profile.id === id))
    .filter((profile): profile is Profile => profile !== undefined);
  const lead = chosen[0];
  if (!lead) return [];
  return lead.layout === "classic" ? [lead] : chosen;
}

export interface SofaChange {
  selection: string[];
  /** A classic profile was tapped: it sits down alone, straight away. */
  start: boolean;
}

/** Tapping a disc on the sofa. */
export function toggleSofa(
  selection: string[],
  profile: Profile,
  profiles: Profile[],
): SofaChange {
  if (profile.layout === "classic")
    return { selection: [profile.id], start: true };
  const studio = selection.filter(
    (id) => profiles.find((p) => p.id === id)?.layout !== "classic",
  );
  return studio.includes(profile.id)
    ? { selection: studio.filter((id) => id !== profile.id), start: false }
    : { selection: [...studio, profile.id], start: false };
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
