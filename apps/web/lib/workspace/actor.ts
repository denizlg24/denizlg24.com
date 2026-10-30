import { agentRunActorSchema } from "@repo/schemas";
import type { AdminSession } from "@/lib/require-admin";
import type { WorkspaceCaller } from "./service";

const ACTOR_UNSAFE = /[^A-Za-z0-9_.-]/g;

/**
 * Who made a change, from what the request can prove. A signed-in session,
 * the desktop's user token and an API key are all the owner. A machine token
 * is a service client (the MCP server); it may name the in-app agent's
 * conversation or task run in `x-agent-actor`. That header is attribution,
 * not authorization: any holder of a service token could claim one, and an
 * owner session's claim is ignored.
 */
export function callerFrom(
  session: AdminSession,
  agentActor: string | null,
): WorkspaceCaller {
  const email = session.user.email;
  if (!email.startsWith("client:")) {
    return { actor: "owner", via: session.via, agent: false };
  }
  const clientId = email
    .slice("client:".length)
    .replace(ACTOR_UNSAFE, "_")
    .slice(0, 96);
  const client = `mcp:${clientId || "unknown"}`;
  const claimed = agentRunActorSchema.safeParse(agentActor);
  return claimed.success
    ? { actor: claimed.data, via: client, agent: true }
    : { actor: client, via: null, agent: true };
}
