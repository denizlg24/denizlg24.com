import { type AdminClient, createAdminClient } from "@repo/admin/client";
import { getAccessToken } from "./auth/session";
import { platformFetch } from "./platform";

const BASE_URL = process.env.NEXT_PUBLIC_DESKTOP_API_BASE_URL ?? "";

/**
 * Desktop AdminClient: talks to the remote admin API over Tauri's HTTP plugin
 * (CORS-bypassing) and authenticates with the OAuth session's access token,
 * resolved per request so a refresh is picked up without rebuilding the client.
 */
export function createDesktopAdminClient(): AdminClient {
  return createAdminClient({
    baseUrl: BASE_URL,
    fetchImpl: platformFetch,
    headers: async () => ({
      authorization: `Bearer ${await getAccessToken()}`,
    }),
  });
}
