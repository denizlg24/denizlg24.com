/**
 * Local preview without a deniz auth tenant: `STREAM_DEV_SUBJECT` stands in
 * for the signed-in account under `next dev` only. A production build folds
 * `NODE_ENV` to "production", so this is dead code there.
 */
export function devSubject(): string | null {
  if (process.env.NODE_ENV !== "development") return null;
  return process.env.STREAM_DEV_SUBJECT || null;
}
