/**
 * Transport for `/api/admin/authenticator/*`.
 *
 * Deliberately local rather than `@repo/admin/client`: that package drags in the
 * whole shared admin dependency graph, and an add-on reviewer has to be able to
 * build this from source with nothing but `@repo/ui` and `@repo/schemas` in the
 * tree. The wire types still come from `@repo/schemas`.
 */

import type {
  IAuthenticatorAccount,
  IAuthenticatorExport,
} from "@repo/schemas";
import type { NewAccountInput } from "./entries";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class OfflineError extends Error {
  constructor(cause?: unknown) {
    super("Could not reach the server");
    this.name = "OfflineError";
    this.cause = cause;
  }
}

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
}

async function request<T>(
  config: ApiConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const base = config.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.apiKey}`,
    accept: "application/json",
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${base}/${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // No cookies: this extension authenticates with the API key and nothing else.
      credentials: "omit",
      cache: "no-store",
    });
  } catch (error) {
    throw new OfflineError(error);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ApiError("API key rejected", response.status);
    }
    const detail = await response.text().catch(() => "");
    throw new ApiError(
      detail.trim().slice(0, 160) || `Request failed (${response.status})`,
      response.status,
    );
  }

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("Server returned a non-JSON response", response.status);
  }
}

/** Every account with its secret — the call that seeds and refreshes the vault. */
export function fetchExport(config: ApiConfig): Promise<IAuthenticatorExport> {
  return request<IAuthenticatorExport>(config, "authenticator/export");
}

export function createRemoteAccount(
  config: ApiConfig,
  input: NewAccountInput,
): Promise<{ account: IAuthenticatorAccount }> {
  return request(config, "authenticator", { method: "POST", body: input });
}

export function updateRemoteAccount(
  config: ApiConfig,
  id: string,
  patch: { label: string; issuer: string; accountName: string },
): Promise<{ account: IAuthenticatorAccount }> {
  return request(config, `authenticator/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

export function deleteRemoteAccount(
  config: ApiConfig,
  id: string,
): Promise<{ success: boolean }> {
  return request(config, `authenticator/${id}`, { method: "DELETE" });
}

/** Cheap credential probe used by setup and by the options page. */
export async function verifyCredentials(config: ApiConfig): Promise<number> {
  const result = await fetchExport(config);
  return result.accounts.length;
}
