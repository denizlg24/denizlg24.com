import { AsyncLocalStorage } from "node:async_hooks";
import {
  AGENT_ACTOR_HEADER,
  agentRunActorSchema,
  MCP_TOOL_PROFILE_HEADER,
  type McpToolProfile,
  mcpToolProfileSchema,
} from "@repo/schemas";

interface RequestContext {
  /** The in-app agent's conversation or task run, as web's connector named it. */
  agentActor: string | null;
  toolProfile: McpToolProfile;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The header wins over `?profile=`, which exists for clients that cannot set headers. */
function requestedProfile(request: Request): McpToolProfile {
  const claimed =
    request.headers.get(MCP_TOOL_PROFILE_HEADER) ??
    new URL(request.url).searchParams.get("profile");
  const parsed = mcpToolProfileSchema.safeParse(claimed);
  return parsed.success ? parsed.data : "full";
}

/** Runs one MCP request with what its HTTP headers say about the caller. */
export function withRequestContext<T>(request: Request, run: () => T): T {
  const claimed = agentRunActorSchema.safeParse(
    request.headers.get(AGENT_ACTOR_HEADER),
  );
  return storage.run(
    {
      agentActor: claimed.success ? claimed.data : null,
      toolProfile: requestedProfile(request),
    },
    run,
  );
}

export function currentAgentActor(): string | null {
  return storage.getStore()?.agentActor ?? null;
}

export function currentToolProfile(): McpToolProfile {
  return storage.getStore()?.toolProfile ?? "full";
}
