import { compareVersions } from "@repo/schemas/stream";

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** Offer an update only for a newer version that was not put off for this version within the day. */
export function shouldOffer(input: {
  installed: string;
  latest: string;
  snoozed: { version: string; until: number } | null;
  now: number;
}): boolean {
  if (compareVersions(input.latest, input.installed) <= 0) return false;
  const { snoozed } = input;
  if (!snoozed) return true;
  return snoozed.version !== input.latest || input.now >= snoozed.until;
}

export function formatSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  return `${Math.round(bytes / 1_000_000)} MB`;
}
