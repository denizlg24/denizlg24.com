import {
  API_BASE_URL,
  rawRequest,
  requestData,
} from "@repo/cloud-ui/api-client";
import { ApiError } from "@repo/cloud-ui/api-error";
import {
  type AccountSummary,
  accountSummarySchema,
  type CompleteSignupInput,
  type CompleteSignupResult,
  type CreateOAuthClientInput,
  completeSignupResultSchema,
  type OAuthClientCredentials,
  type OAuthClientList,
  oauthClientCredentialsSchema,
  oauthClientListSchema,
  type PublicSignUpInput,
  type PublicTenant,
  publicSignUpResultSchema,
  publicTenantSchema,
  type SafeUser,
  safeUserSchema,
  type TrustedDevicesRevoked,
  type TrustedDevicesSummary,
  trustedDevicesRevokedSchema,
  trustedDevicesSummarySchema,
} from "@repo/schemas/cloud";
import { z } from "zod";

export {
  ApiError,
  errorMessage,
  isApiError,
} from "@repo/cloud-ui/api-error";

const publicClientSchema = z.object({
  client_id: z.string(),
  client_name: z.string().optional(),
  client_uri: z.string().optional(),
  logo_uri: z.string().optional(),
});
export type PublicClient = z.infer<typeof publicClientSchema>;

const deviceRequestSchema = z.object({
  user_code: z.string(),
  status: z.enum(["pending", "approved", "denied"]),
  client_id: z.string().optional(),
});
export type DeviceRequest = z.infer<typeof deviceRequestSchema>;

const clientUpdateSchema = z.object({
  clientId: z.string(),
  disabled: z.boolean(),
});

function clientPath(clientId: string, suffix = ""): string {
  return `/api/oauth/clients/${encodeURIComponent(clientId)}${suffix}`;
}

/**
 * Better Auth's own routes answer `{ code, message }`; ours answer the same
 * with an `error` object beside it. Either becomes an ApiError.
 */
async function flowError(response: Response): Promise<ApiError> {
  return flowErrorFrom(
    await response.json().catch(() => null),
    response.status,
  );
}

function flowErrorFrom(body: unknown, status: number): ApiError {
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const nested =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : record;
  const code = typeof nested.code === "string" ? nested.code : "HTTP_ERROR";
  const message =
    typeof nested.message === "string"
      ? nested.message
      : `Request failed (${status})`;
  return new ApiError(code, message, status);
}

/**
 * A request that mails someone. Each carries a fresh bot-check token, which
 * the shared client has no way to attach.
 */
async function challengedPost(
  path: string,
  body: unknown,
  turnstileToken: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(new URL(path, API_BASE_URL), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Turnstile-Token": turnstileToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ApiError(
      "NETWORK",
      "We couldn't reach the server. Try again.",
      0,
    );
  }
  if (!response.ok) throw await flowError(response);
  return response.json().catch(() => null);
}

/**
 * The device-authorization routes answer RFC 8628's `{ error, error_description }`,
 * or ours (`{ code, message }`) when the account is refused before approval.
 */
async function deviceRequest(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(new URL(path, API_BASE_URL), {
      method: init.method,
      credentials: "include",
      headers:
        init.body === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ApiError(
      "NETWORK",
      "We couldn't reach the server. Try again.",
      0,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  if (typeof record.error === "string") {
    throw new ApiError(
      record.error,
      typeof record.error_description === "string"
        ? record.error_description
        : `Request failed (${response.status})`,
      response.status,
    );
  }
  throw flowErrorFrom(body, response.status);
}

export const api = {
  /** Any deniz account, cloud or public; `/api/me` only ever answers for the cloud's. */
  account: (): Promise<AccountSummary> =>
    requestData(accountSummarySchema, "/api/account"),
  /** The app behind a client id, when it is someone else's. 404 for the owner's own. */
  publicTenant: (clientId: string): Promise<PublicTenant> =>
    requestData(
      publicTenantSchema,
      `/api/public/tenants/client/${encodeURIComponent(clientId)}`,
    ),
  signUp: async (input: PublicSignUpInput, turnstileToken: string) =>
    z
      .object({ data: publicSignUpResultSchema })
      .parse(
        await challengedPost("/api/auth/public/sign-up", input, turnstileToken),
      ).data,
  resendVerification: async (
    input: { email: string; callbackURL: string },
    turnstileToken: string,
  ): Promise<void> => {
    await challengedPost(
      "/api/auth/send-verification-email",
      input,
      turnstileToken,
    );
  },
  requestPasswordReset: async (
    input: { email: string; redirectTo: string },
    turnstileToken: string,
  ): Promise<void> => {
    await challengedPost(
      "/api/auth/request-password-reset",
      input,
      turnstileToken,
    );
  },
  resetPassword: async (input: {
    newPassword: string;
    token: string;
  }): Promise<void> => {
    let response: Response;
    try {
      response = await fetch(
        new URL("/api/auth/reset-password", API_BASE_URL),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      throw new ApiError(
        "NETWORK",
        "We couldn't reach the server. Try again.",
        0,
      );
    }
    if (!response.ok) throw await flowError(response);
  },
  me: (): Promise<SafeUser> => requestData(safeUserSchema, "/api/me"),
  /** Claims the code for this account and names the client behind it. */
  verifyDevice: async (userCode: string): Promise<DeviceRequest> =>
    deviceRequestSchema.parse(
      await deviceRequest(
        `/api/auth/device?user_code=${encodeURIComponent(userCode)}`,
        { method: "GET" },
      ),
    ),
  decideDevice: async (userCode: string, approve: boolean): Promise<void> => {
    await deviceRequest(
      approve ? "/api/auth/device/approve" : "/api/auth/device/deny",
      {
        method: "POST",
        body: { userCode },
      },
    );
  },
  completeSignup: (input: CompleteSignupInput): Promise<CompleteSignupResult> =>
    requestData(completeSignupResultSchema, "/api/auth/complete-signup", {
      method: "POST",
      body: input,
    }),
  publicClient: async (clientId: string): Promise<PublicClient> =>
    publicClientSchema.parse(
      await rawRequest("/api/auth/oauth2/public-client", {
        query: { client_id: clientId },
      }),
    ),
  clients: (): Promise<OAuthClientList> =>
    requestData(oauthClientListSchema, "/api/oauth/clients"),
  createClient: (
    input: CreateOAuthClientInput,
  ): Promise<OAuthClientCredentials> =>
    requestData(oauthClientCredentialsSchema, "/api/oauth/clients", {
      method: "POST",
      body: input,
    }),
  rotateClientSecret: (clientId: string): Promise<OAuthClientCredentials> =>
    requestData(
      oauthClientCredentialsSchema,
      clientPath(clientId, "/rotate-secret"),
      { method: "POST" },
    ),
  setClientDisabled: (clientId: string, disabled: boolean) =>
    requestData(clientUpdateSchema, clientPath(clientId), {
      method: "PATCH",
      body: { disabled },
    }),
  trustedDevices: (): Promise<TrustedDevicesSummary> =>
    requestData(trustedDevicesSummarySchema, "/api/auth/trusted-devices"),
  revokeTrustedDevices: (): Promise<TrustedDevicesRevoked> =>
    requestData(
      trustedDevicesRevokedSchema,
      "/api/auth/trusted-devices/revoke",
      { method: "POST" },
    ),
};
