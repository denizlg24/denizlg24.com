import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/client";
import {
  adminClient,
  twoFactorClient,
  usernameClient,
} from "better-auth/client/plugins";

export const CLOUD_AUTH_BASE_URL = "https://api.denizlg24.com";

export interface CloudAuthClientOptions {
  baseURL?: string;
}

export function createCloudAuthClient(options: CloudAuthClientOptions = {}) {
  return createAuthClient({
    baseURL: options.baseURL ?? CLOUD_AUTH_BASE_URL,
    fetchOptions: {
      credentials: "include",
    },
    plugins: [adminClient(), twoFactorClient(), usernameClient()] as const,
  });
}

export type CloudAuthClient = ReturnType<typeof createCloudAuthClient>;

/**
 * The auth app's client. The OAuth provider plugin forwards the signed
 * authorization query on every request made from a page the authorization
 * server redirected to, which is what lets a plain sign-in resume the
 * authorization it interrupted.
 */
export function createCloudOAuthClient(options: CloudAuthClientOptions = {}) {
  return createAuthClient({
    baseURL: options.baseURL ?? CLOUD_AUTH_BASE_URL,
    fetchOptions: {
      credentials: "include",
    },
    plugins: [
      adminClient(),
      twoFactorClient(),
      usernameClient(),
      oauthProviderClient(),
    ] as const,
  });
}

export type CloudOAuthClient = ReturnType<typeof createCloudOAuthClient>;
