import type { NativeAuth } from "./session";
import { NotSignedInError } from "./session";

type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Serialised as JSON. */
  body?: unknown;
  formData?: FormData;
  query?: QueryParams;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

/** The request never reached the server: offline, DNS, TLS, timeout. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Offline", { cause });
    this.name = "NetworkError";
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface AdminApi {
  /** JSON in, JSON out, under `/api/admin/`. Throws `AdminApiError` on non-2xx. */
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  /** The authorized response as is: streams, audio. Throws on non-2xx. */
  raw(
    path: string,
    options?: RequestOptions,
    fetcher?: Fetch,
  ): Promise<Response>;
}

export function adminUrl(site: string, path: string, query?: QueryParams) {
  const url = new URL(`/api/admin/${path.replace(/^\/+/, "")}`, site);
  for (const [key, raw] of Object.entries(query ?? {})) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === undefined || value === null) continue;
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
}

async function errorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return `Request failed (${response.status})`;
}

export function createAdminApi({
  site,
  auth,
  fetch: defaultFetch,
  headers: extraHeaders,
}: {
  site: string;
  auth: NativeAuth;
  fetch: Fetch;
  /** Sent on every request, e.g. the installation id. */
  headers?: () => Record<string, string>;
}): AdminApi {
  async function raw(
    path: string,
    options: RequestOptions = {},
    fetcher: Fetch = defaultFetch,
  ) {
    const url = adminUrl(site, path, options.query);
    const send = async (token: string) => {
      try {
        return await fetcher(url, {
          method:
            options.method ??
            (options.body || options.formData ? "POST" : "GET"),
          signal: options.signal,
          headers: {
            authorization: `Bearer ${token}`,
            ...(options.body !== undefined
              ? { "content-type": "application/json" }
              : {}),
            ...extraHeaders?.(),
            ...options.headers,
          },
          body:
            options.formData ??
            (options.body !== undefined
              ? JSON.stringify(options.body)
              : undefined),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new NetworkError(error);
      }
    };
    const token = await auth.getAccessToken();
    let response = await send(token);
    if (response.status === 401) {
      response = await send(await auth.getAccessToken({ rejected: token }));
      if (response.status === 401) {
        await auth.expire();
        throw new NotSignedInError();
      }
    }
    if (!response.ok) {
      throw new AdminApiError(response.status, await errorMessage(response));
    }
    return response;
  }

  return {
    raw,
    async request<T>(path: string, options?: RequestOptions) {
      const response = await raw(path, options);
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    },
  };
}
