import { AuthUnavailableError } from "@denizlg24/auth/client";
import type { z } from "zod";
import { session } from "./auth";
import { API_URL } from "./config";
import { ApiError, NetworkError } from "./errors";

export { ApiError, isApiError, NetworkError } from "./errors";

type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Serialised as JSON. */
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
}

export function apiUrl(path: string, query?: QueryParams): string {
  const url = `${API_URL}/api/v1/${path.replace(/^\/+/, "")}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.append(key, String(value));
  }
  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

async function errorCode(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null);
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return null;
}

async function send(
  path: string,
  options: RequestOptions,
): Promise<Response | null> {
  let token: string | null;
  try {
    token = await session.getAccessToken();
  } catch (error) {
    if (error instanceof AuthUnavailableError) throw new NetworkError(error);
    throw error;
  }
  if (!token) throw new ApiError(401, "signed_out");
  let response: Response;
  try {
    response = await fetch(apiUrl(path, options.query), {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      signal: options.signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(options.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new NetworkError(error);
  }
  if (response.status === 401) {
    // The SDK refreshes before expiry, so a refused token means the grant is gone.
    await session.signOut();
    throw new ApiError(401, await errorCode(response));
  }
  if (!response.ok) {
    throw new ApiError(response.status, await errorCode(response));
  }
  return response.status === 204 ? null : response;
}

/** JSON in, JSON out under `/api/v1/`, parsed with the contract's schema. */
export async function api<S extends z.ZodType>(
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.infer<S>> {
  const response = await send(path, options);
  if (!response) throw new ApiError(204, "empty_response");
  return schema.parse(await response.json());
}

/** For routes whose answer the app does not read. */
export async function apiVoid(
  path: string,
  options: RequestOptions = {},
): Promise<void> {
  await send(path, options);
}
