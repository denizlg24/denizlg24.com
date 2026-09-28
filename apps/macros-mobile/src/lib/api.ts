import { authClient } from "./auth-client";
import { API_URL } from "./config";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type QueryValue = string | number | boolean | null | undefined;

export type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

export interface RequestOptions {
  method?: Method;
  /** Serialised as JSON. Mutually exclusive with `formData`. */
  body?: unknown;
  formData?: FormData;
  query?: QueryParams;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly issues: readonly unknown[];

  constructor(status: number, message: string, issues: readonly unknown[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

/** The request never reached the server: offline, DNS, TLS, timeout. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("You're offline or the server can't be reached.", { cause });
    this.name = "NetworkError";
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Registered once by the session gate; fires when the server rejects our cookie. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

/** For requests that bypass `api()` (native uploads) but carry the session. */
export function reportUnauthorized() {
  unauthorizedHandler?.();
}

export function buildUrl(path: string, query?: QueryParams): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, API_URL);
  if (query) {
    for (const [key, raw] of Object.entries(query)) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (value === undefined || value === null) continue;
        url.searchParams.append(key, String(value));
      }
    }
  }
  return url.toString();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function readErrorBody(body: unknown, status: number) {
  if (body && typeof body === "object") {
    const message =
      "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (${status})`;
    const issues =
      "issues" in body && Array.isArray(body.issues) ? body.issues : [];
    return { message, issues };
  }
  return { message: `Request failed (${status})`, issues: [] };
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };
  const cookie = await authClient.getCookie();
  if (cookie) headers.Cookie = cookie;

  let body: FormData | string | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body,
      signal: options.signal,
      // The session travels in the Cookie header above; letting the native
      // cookie jar add its own copy produces two conflicting session cookies.
      credentials: "omit",
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new NetworkError(error);
  }
}

export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await send(path, options);

  if (response.status === 401) unauthorizedHandler?.();

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const { message, issues } = readErrorBody(payload, response.status);
    throw new ApiError(response.status, message, issues);
  }

  return response.json();
}

/** For endpoints that answer 204 with no body. */
export async function apiVoid(
  path: string,
  options: RequestOptions = {},
): Promise<void> {
  const response = await send(path, options);
  if (response.status === 401) unauthorizedHandler?.();
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const { message, issues } = readErrorBody(payload, response.status);
    throw new ApiError(response.status, message, issues);
  }
}

/** For endpoints that answer with a file instead of JSON (statistics export). */
export async function apiText(
  path: string,
  options: RequestOptions = {},
): Promise<string> {
  const response = await send(path, options);
  if (response.status === 401) unauthorizedHandler?.();
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `Request failed (${response.status})`,
      [],
    );
  }
  return response.text();
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  return error instanceof ApiError && error.status >= 500;
}
