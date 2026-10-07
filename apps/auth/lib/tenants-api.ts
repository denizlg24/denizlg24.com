import { API_BASE_URL, requestData } from "@repo/cloud-ui/api-client";
import { isApiError } from "@repo/cloud-ui/api-error";
import {
  type AccountSummary,
  type AddTenantMemberInput,
  accountSummarySchema,
  type BlockTenantUserInput,
  type ConnectedApp,
  type CreateOAuthClientInput,
  type CreateTenantInput,
  type CreateTenantResourceInput,
  connectedAppSchema,
  type OAuthClientCredentials,
  type OAuthResourceSummary,
  oauthClientCredentialsSchema,
  oauthResourceSummarySchema,
  type TenantDetail,
  type TenantSummary,
  type TenantUserList,
  tenantDetailSchema,
  tenantSummarySchema,
  tenantUserListSchema,
  type UpdateTenantInput,
} from "@repo/schemas/cloud";
import { z } from "zod";

/**
 * The issuer a tenant's app is configured with. Derived from the API this
 * build talks to, so a dev build shows the dev issuer rather than production.
 */
export const AUTH_ISSUER = new URL("/api/auth", API_BASE_URL).href;

export const SDK_PACKAGE = "@denizlg24/auth";

/**
 * Mutations answer with a small acknowledgement the pages never read; they
 * reload the resource instead, so the envelope is checked and the rest dropped.
 */
const acknowledgement = z.unknown();

function tenantPath(slug: string, suffix = ""): string {
  return `/api/tenants/${encodeURIComponent(slug)}${suffix}`;
}

export const accountApi = {
  summary: (): Promise<AccountSummary> =>
    requestData(accountSummarySchema, "/api/account"),
  connectedApps: (): Promise<ConnectedApp[]> =>
    requestData(z.array(connectedAppSchema), "/api/account/apps"),
  removeConnectedApp: async (clientId: string): Promise<void> => {
    await requestData(
      acknowledgement,
      `/api/account/apps/${encodeURIComponent(clientId)}`,
      { method: "DELETE" },
    );
  },
};

export interface TenantUserQuery {
  q?: string;
  limit: number;
  offset: number;
}

export const tenantsApi = {
  list: (): Promise<TenantSummary[]> =>
    requestData(z.array(tenantSummarySchema), "/api/tenants"),
  create: (input: CreateTenantInput): Promise<TenantSummary> =>
    requestData(tenantSummarySchema, "/api/tenants", {
      method: "POST",
      body: input,
    }),
  detail: (slug: string): Promise<TenantDetail> =>
    requestData(tenantDetailSchema, tenantPath(slug)),
  update: (slug: string, input: UpdateTenantInput): Promise<TenantSummary> =>
    requestData(tenantSummarySchema, tenantPath(slug), {
      method: "PATCH",
      body: input,
    }),
  remove: async (slug: string): Promise<void> => {
    await requestData(acknowledgement, tenantPath(slug), { method: "DELETE" });
  },

  addResource: (
    slug: string,
    input: CreateTenantResourceInput,
  ): Promise<OAuthResourceSummary> =>
    requestData(oauthResourceSummarySchema, tenantPath(slug, "/resources"), {
      method: "POST",
      body: input,
    }),
  removeResource: async (slug: string, identifier: string): Promise<void> => {
    await requestData(acknowledgement, tenantPath(slug, "/resources"), {
      method: "DELETE",
      query: { identifier },
    });
  },

  createClient: (
    slug: string,
    input: CreateOAuthClientInput,
  ): Promise<OAuthClientCredentials> =>
    requestData(oauthClientCredentialsSchema, tenantPath(slug, "/clients"), {
      method: "POST",
      body: input,
    }),
  setClientDisabled: async (
    slug: string,
    clientId: string,
    disabled: boolean,
  ): Promise<void> => {
    await requestData(
      acknowledgement,
      tenantPath(slug, `/clients/${encodeURIComponent(clientId)}`),
      { method: "PATCH", body: { disabled } },
    );
  },
  deleteClient: async (slug: string, clientId: string): Promise<void> => {
    await requestData(
      acknowledgement,
      tenantPath(slug, `/clients/${encodeURIComponent(clientId)}`),
      { method: "DELETE" },
    );
  },

  users: (slug: string, query: TenantUserQuery): Promise<TenantUserList> =>
    requestData(tenantUserListSchema, tenantPath(slug, "/users"), {
      query: {
        q: query.q || undefined,
        limit: query.limit,
        offset: query.offset,
      },
    }),
  blockUser: async (
    slug: string,
    userId: string,
    input: BlockTenantUserInput,
  ): Promise<void> => {
    await requestData(
      acknowledgement,
      tenantPath(slug, `/users/${encodeURIComponent(userId)}/block`),
      { method: "POST", body: input },
    );
  },
  unblockUser: async (slug: string, userId: string): Promise<void> => {
    await requestData(
      acknowledgement,
      tenantPath(slug, `/users/${encodeURIComponent(userId)}/block`),
      { method: "DELETE" },
    );
  },
  signOutUser: async (slug: string, userId: string): Promise<void> => {
    await requestData(
      acknowledgement,
      tenantPath(slug, `/users/${encodeURIComponent(userId)}/revoke`),
      { method: "POST", body: {} },
    );
  },

  addMember: async (
    slug: string,
    input: AddTenantMemberInput,
  ): Promise<void> => {
    await requestData(acknowledgement, tenantPath(slug, "/members"), {
      method: "POST",
      body: input,
    });
  },
  removeMember: async (slug: string, userId: string): Promise<void> => {
    await requestData(
      acknowledgement,
      tenantPath(slug, `/members/${encodeURIComponent(userId)}`),
      { method: "DELETE" },
    );
  },
};

/**
 * Two refusals on the tenant routes are states a page draws, not errors:
 * an account without two-factor, and an app the caller does not manage
 * (which the API answers exactly like one that does not exist).
 */
export type TenantLoad<T> =
  | { status: "ok"; data: T }
  | { status: "mfa-required" }
  | { status: "not-found" };

export async function loadTenantRoute<T>(
  load: () => Promise<T>,
): Promise<TenantLoad<T>> {
  try {
    return { status: "ok", data: await load() };
  } catch (error) {
    if (isApiError(error) && error.code === "MFA_ENROLLMENT_REQUIRED") {
      return { status: "mfa-required" };
    }
    if (isApiError(error) && error.status === 404) {
      return { status: "not-found" };
    }
    throw error;
  }
}
