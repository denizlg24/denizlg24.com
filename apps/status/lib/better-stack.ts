import { z } from "zod";

const BASE = "https://uptime.betterstack.com";
const resource = z.object({
  id: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  relationships: z
    .record(
      z.string(),
      z.object({ data: z.object({ id: z.string() }).nullable() }),
    )
    .optional(),
});
export type BetterResource = z.infer<typeof resource>;
const pageSchema = z.object({
  data: z.array(resource),
  pagination: z.object({ next: z.string().nullable().optional() }).optional(),
});

export async function betterRequest(path: string, init: RequestInit = {}) {
  const token = process.env.BETTERSTACK_API_TOKEN;
  if (!token) throw new Error("Better Stack is not configured");
  const url = new URL(path, BASE);
  if (url.origin !== BASE || !url.pathname.startsWith("/api/"))
    throw new Error("Invalid Better Stack API path");
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      `Better Stack returned HTTP ${response.status}${response.status === 429 ? "; rate limited, retry later" : ""}`,
    );
  return response.json() as Promise<unknown>;
}
export async function betterList(path: string): Promise<BetterResource[]> {
  const result: BetterResource[] = [];
  let next: string | null = path;
  const seen = new Set<string>();
  while (next) {
    if (seen.has(next) || seen.size >= 50)
      throw new Error("Better Stack pagination did not finish");
    seen.add(next);
    const page = pageSchema.parse(await betterRequest(next));
    result.push(...page.data);
    next = page.pagination?.next ?? null;
  }
  return result;
}
const seconds = z.number().finite().nonnegative();
export const responseTimesSchema = z.object({
  data: z.object({
    attributes: z.object({
      regions: z.array(
        z.object({
          region: z.string(),
          response_times: z.array(
            z.object({
              at: z.iso.datetime({ offset: true }),
              response_time: seconds,
              name_lookup_time: seconds.nullish(),
              connection_time: seconds.nullish(),
              tls_handshake_time: seconds.nullish(),
              data_transfer_time: seconds.nullish(),
            }),
          ),
        }),
      ),
    }),
  }),
});
export function textAttribute(
  item: BetterResource,
  key: string,
): string | null {
  const value = item.attributes[key];
  return typeof value === "string" ? value : null;
}
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}
