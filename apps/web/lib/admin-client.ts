import { type AdminClient, createAdminClient } from "@repo/admin/client";

/**
 * Web AdminClient: calls the app's own same-origin `/api/admin/*` routes from
 * the browser. `requireAdmin` already accepts the better-auth session cookie, so
 * `credentials: "include"` authenticates with no Bearer token needed.
 */
export function createWebAdminClient(): AdminClient {
  return createAdminClient({
    baseUrl: "/api/admin",
    credentials: "include",
  });
}
