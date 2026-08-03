import { tickerSchema } from "@repo/markets/schemas";
import { isValidObjectId } from "mongoose";

/**
 * Path and query parsing shared by the markets routes.
 *
 * Two things bite without it. A malformed ObjectId reaches a `findById*` helper
 * and Mongoose throws `CastError`, which surfaces as a 500 rather than a 404.
 * And `Math.min(Number(input) || fallback, cap)` caps the top but not the
 * bottom, because a negative number is truthy — the negative value then reaches
 * provider requests and Mongo queries.
 */

export function parseObjectId(value: string): string | null {
  return isValidObjectId(value) ? value : null;
}

/** Next.js decodes path segments, so separators and control characters can
 * reach the provider URL builders and the cache keys unless the segment is
 * validated. */
export function parseTicker(value: string): string | null {
  const parsed = tickerSchema.safeParse(value.toUpperCase());
  return parsed.success ? parsed.data : null;
}

export function parseLimit(
  raw: string | null,
  fallback: number,
  cap: number,
): number {
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, cap);
}
