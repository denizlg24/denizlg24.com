export function archiveLog(message: string): void {
  console.log(`[markets-relay] archive: ${message}`);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(ms: number, fraction: number): number {
  return Math.round(ms * (1 + (Math.random() * 2 - 1) * fraction));
}

export function at(value: unknown, ...path: (string | number)[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      if (typeof current !== "object" || current === null) return undefined;
      current = Reflect.get(current, key);
    }
  }
  return current;
}

export class HttpError extends Error {
  constructor(
    readonly host: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`${host} answered HTTP ${status}`);
  }
}

export async function fetchJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 15_000,
): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new HttpError(
      new URL(url).host,
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  const body: unknown = await response.json();
  return body;
}
