/**
 * AdminClient — the data-access seam shared admin feature components depend on.
 *
 * Components never fetch directly; they call an injected `AdminClient`. Each app
 * supplies one via `createAdminClient` with its own transport config:
 *   - desktop: Tauri `platformFetch` + Bearer token
 *   - web: native `fetch` against same-origin `/api/admin` + session cookie
 *
 * Unlike the desktop `denizApi` (which returns `T | AuthError | ApiError`), this
 * transport THROWS `AdminApiError` on failure so shared components use plain
 * try/catch. The union-handling stays an adapter-internal detail.
 */

export class AdminApiError extends Error {
  readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = "AdminApiError";
    this.code = code;
  }
}

export interface AdminRequestOptions {
  signal?: AbortSignal;
}

export interface AdminRawInit {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export interface AdminClient {
  get<T>(endpoint: string, options?: AdminRequestOptions): Promise<T>;
  post<T>(
    endpoint: string,
    body?: unknown,
    options?: AdminRequestOptions,
  ): Promise<T>;
  put<T>(
    endpoint: string,
    body?: unknown,
    options?: AdminRequestOptions,
  ): Promise<T>;
  patch<T>(
    endpoint: string,
    body?: unknown,
    options?: AdminRequestOptions,
  ): Promise<T>;
  del<T>(endpoint: string, options?: AdminRequestOptions): Promise<T>;
  upload<T>(
    endpoint: string,
    formData: FormData,
    options?: AdminRequestOptions,
  ): Promise<T>;
  /** Escape hatch for streaming / binary responses. Throws on non-2xx, else returns the raw Response. */
  raw(endpoint: string, init?: AdminRawInit): Promise<Response>;
}

/** Structural fetch signature — looser than `typeof fetch` (no `preconnect`). */
export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface AdminTransportConfig {
  /** e.g. "/api/admin" (web) or "https://denizlg24.com/api/admin" (desktop). */
  baseUrl: string;
  /** Defaults to global fetch. Desktop passes Tauri's `platformFetch`. */
  fetchImpl?: FetchLike;
  /** Per-request auth/extra headers (e.g. Bearer token). Resolved at call time. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** "include" lets the browser send the session cookie cross-route. */
  credentials?: RequestCredentials;
}

async function buildError(res: Response): Promise<AdminApiError> {
  const fallback = `Request failed with HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) {
    return new AdminApiError("Not authorized", res.status);
  }
  try {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await res.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const message =
        (data && typeof data.message === "string" && data.message) ||
        (data && typeof data.error === "string" && data.error) ||
        (data && typeof data.title === "string" && data.title) ||
        fallback;
      return new AdminApiError(message, res.status);
    }
    const text = (await res.text()).trim();
    return new AdminApiError(
      text ? `${fallback}: ${text.slice(0, 180)}` : fallback,
      res.status,
    );
  } catch {
    return new AdminApiError(fallback, res.status);
  }
}

interface InternalRequest {
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
}

export function createAdminClient(config: AdminTransportConfig): AdminClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = config.baseUrl.replace(/\/$/, "");

  async function resolveHeaders(
    extra?: Record<string, string>,
  ): Promise<Record<string, string>> {
    const provided = config.headers ? await config.headers() : {};
    return { ...provided, ...extra };
  }

  async function doRequest(
    method: string,
    endpoint: string,
    req: InternalRequest,
  ): Promise<Response> {
    const isJsonBody = !req.formData && req.body !== undefined;
    const headers = await resolveHeaders(
      isJsonBody ? { "content-type": "application/json" } : undefined,
    );

    const res = await fetchImpl(`${base}/${endpoint}`, {
      method,
      headers,
      credentials: config.credentials,
      body: req.formData ?? (isJsonBody ? JSON.stringify(req.body) : undefined),
      signal: req.signal,
    });

    if (!res.ok) throw await buildError(res);
    return res;
  }

  async function json<T>(
    method: string,
    endpoint: string,
    req: InternalRequest,
  ): Promise<T> {
    const res = await doRequest(method, endpoint, req);
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AdminApiError(
        `Non-JSON response (status ${res.status})`,
        res.status,
      );
    }
  }

  return {
    get: <T>(endpoint: string, options?: AdminRequestOptions) =>
      json<T>("GET", endpoint, { signal: options?.signal }),
    post: <T>(
      endpoint: string,
      body?: unknown,
      options?: AdminRequestOptions,
    ) =>
      json<T>("POST", endpoint, { body: body ?? {}, signal: options?.signal }),
    put: <T>(endpoint: string, body?: unknown, options?: AdminRequestOptions) =>
      json<T>("PUT", endpoint, { body: body ?? {}, signal: options?.signal }),
    patch: <T>(
      endpoint: string,
      body?: unknown,
      options?: AdminRequestOptions,
    ) =>
      json<T>("PATCH", endpoint, { body: body ?? {}, signal: options?.signal }),
    del: <T>(endpoint: string, options?: AdminRequestOptions) =>
      json<T>("DELETE", endpoint, { signal: options?.signal }),
    upload: <T>(
      endpoint: string,
      formData: FormData,
      options?: AdminRequestOptions,
    ) => json<T>("POST", endpoint, { formData, signal: options?.signal }),
    raw: (endpoint: string, init?: AdminRawInit) =>
      doRequest(init?.method ?? "GET", endpoint, {
        body: init?.body,
        signal: init?.signal,
      }),
  };
}
