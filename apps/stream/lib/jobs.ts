import "server-only";

import { timingSafeEqual } from "node:crypto";

export function authorizedJob(request: Request): boolean {
  const secret = process.env.STREAM_CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
