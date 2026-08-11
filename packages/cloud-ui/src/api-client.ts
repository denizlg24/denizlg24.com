import { type Pagination, paginationSchema } from "@repo/schemas/cloud";
import { z } from "zod";
import { toApiError, toTransportError } from "./api-error";

// NEXT_PUBLIC_* values are inlined at build time by whichever app bundles this
// package. Fall back to the local dev services, never to production: a build
// that forgot the Vercel variables should break loudly instead of pointing an
// admin app at the live API.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_CLOUD_API_URL ?? "http://localhost:3001";

type QueryValue = string | number | boolean | undefined;
export type Query = Record<string, QueryValue | QueryValue[]>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
  timeoutMs?: number;
}

// Without a deadline a stalled connection keeps `usePoll` in `loading` forever
// and every interval tick stacks another hung request on top of it.
const DEFAULT_TIMEOUT_MS = 30_000;
// Query consoles, provisioning and manual task runs legitimately take longer.
export const SLOW_TIMEOUT_MS = 120_000;
// One container replacement per live deployment, each gated on a 90s health
// check, and the API waits 150s on the agent before giving up on one.
export const APPLY_ENV_TIMEOUT_MS = 300_000;

export function buildUrl(path: string, query: RequestOptions["query"]): URL {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== undefined) url.searchParams.append(key, String(entry));
    }
  }
  return url;
}

export async function sendRequest(
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      credentials: "include",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers:
        options.body !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    throw toTransportError(error);
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

export async function rawRequest(
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  return (await sendRequest(path, options)).json();
}

/**
 * Buffers the response and hands it to the browser as a download.
 *
 * A plain anchor would be lighter, but the session cookie is set on the API's
 * origin and this app is served from another, so only a `credentials: "include"`
 * fetch is guaranteed to carry it.
 */
export async function requestDownload(
  path: string,
  fallbackFilename: string,
  options: RequestOptions = {},
): Promise<void> {
  const response = await sendRequest(path, options);
  const disposition = response.headers.get("Content-Disposition");
  const filename =
    disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallbackFilename;

  const href = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(href);
  }
}

const envelopeSchema = z.object({ data: z.unknown() });

export async function requestData<T extends z.ZodType>(
  schema: T,
  path: string,
  options: RequestOptions = {},
): Promise<z.output<T>> {
  const payload = await rawRequest(path, options);
  return schema.parse(envelopeSchema.parse(payload).data);
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

const paginatedEnvelopeSchema = z.object({
  data: z.array(z.unknown()),
  pagination: paginationSchema,
});

export async function requestPaginated<T extends z.ZodType>(
  schema: T,
  path: string,
  options: RequestOptions = {},
): Promise<Paginated<z.output<T>>> {
  const payload = await rawRequest(path, options);
  const parsed = paginatedEnvelopeSchema.parse(payload);
  return {
    items: parsed.data.map((item) => schema.parse(item)),
    pagination: parsed.pagination,
  };
}
