import { type AdminClient, createAdminClient } from "@repo/admin/client";
import { platformFetch } from "./platform";

const BASE_URL = process.env.NEXT_PUBLIC_DESKTOP_API_BASE_URL ?? "";

/**
 * Desktop AdminClient: talks to the remote admin API over Tauri's HTTP plugin
 * (CORS-bypassing) and authenticates with the user's Bearer token.
 */
export function createDesktopAdminClient(apiKey: string): AdminClient {
  return createAdminClient({
    baseUrl: BASE_URL,
    fetchImpl: platformFetch,
    headers: () => ({ authorization: `Bearer ${apiKey}` }),
  });
}
