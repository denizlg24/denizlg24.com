import type { AdminSession } from "@/lib/require-admin";

/**
 * Only the runner's own machine client may drive runs. Every other admin
 * credential — the owner's session, an API key, the MCP server — is refused.
 */
export function isAgentRunner(
  session: AdminSession | null,
  runnerClientId: string | undefined,
): boolean {
  const clientId = runnerClientId?.trim();
  if (!clientId || !session) return false;
  return session.via === "oauth" && session.user.email === `client:${clientId}`;
}
