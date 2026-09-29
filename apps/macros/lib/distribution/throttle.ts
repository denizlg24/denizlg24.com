/**
 * Per-process and forgotten on restart. It only has to keep one script from
 * filling the request list; the owner reads every row anyway.
 */
export function createThrottle({
  limit,
  windowMs,
  maxKeys = 10_000,
}: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}) {
  const hits = new Map<string, number[]>();

  return function allow(key: string, now = Date.now()): boolean {
    const recent = (hits.get(key) ?? []).filter(
      (time) => now - time < windowMs,
    );
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.delete(key);
    hits.set(key, recent);

    // Maps iterate in insertion order and every hit re-inserts its key, so
    // the first key is the least recently seen.
    if (hits.size > maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    return true;
  };
}

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  return (
    forwarded?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown"
  );
}
