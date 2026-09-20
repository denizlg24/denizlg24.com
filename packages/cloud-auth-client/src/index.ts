import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import {
  adminClient,
  inferAdditionalFields,
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
 * authorization it interrupted. Passkeys are here and not on the plain
 * client because the API only accepts ceremonies from the auth app's origin.
 */
export function createCloudOAuthClient(options: CloudAuthClientOptions = {}) {
  return createAuthClient({
    baseURL: options.baseURL ?? CLOUD_AUTH_BASE_URL,
    fetchOptions: {
      credentials: "include",
    },
    plugins: [
      adminClient(),
      passkeyClient(),
      twoFactorClient(),
      usernameClient(),
      oauthProviderClient(),
      // Mirrors `user.additionalFields` on the API so the session user and
      // `updateUser` carry the field; the server is the one that validates it.
      inferAdditionalFields({
        user: { passkeyOfferDismissed: { type: "boolean", required: false } },
      }),
    ] as const,
  });
}

export type CloudOAuthClient = ReturnType<typeof createCloudOAuthClient>;
