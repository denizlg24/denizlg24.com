import { AsyncLocalStorage } from "node:async_hooks";
import { AGENT_ACTOR_HEADER, agentRunActorSchema } from "@repo/schemas";

interface RequestContext {
  /** The in-app agent's conversation or task run, as web's connector named it. */
  agentActor: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs one MCP request with what its HTTP headers say about the caller. */
export function withRequestContext<T>(request: Request, run: () => T): T {
  const claimed = agentRunActorSchema.safeParse(
    request.headers.get(AGENT_ACTOR_HEADER),
  );
  return storage.run(
    { agentActor: claimed.success ? claimed.data : null },
    run,
  );
}

export function currentAgentActor(): string | null {
  return storage.getStore()?.agentActor ?? null;
}
