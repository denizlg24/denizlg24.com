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
