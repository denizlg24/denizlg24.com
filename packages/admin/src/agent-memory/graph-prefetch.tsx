import type { AgentMemoryGraphResponse } from "@repo/schemas";
import { agentMemoryGraphResponseSchema } from "@repo/schemas";
import type { AdminClient } from "../client";

// Module-level cache so the graph can be fetched once on app load and reused
// when the agent-memory page mounts. Keyed per session, not per client: this
// is a single-user app and every client targets the same account.
let cache: {
  promise: Promise<AgentMemoryGraphResponse>;
  fetchedAt: number;
} | null = null;

const MAX_AGE_MS = 5 * 60_000;

export function fetchAgentMemoryGraph(
  client: AdminClient,
  options: { force?: boolean } = {},
): Promise<AgentMemoryGraphResponse> {
  if (cache && !options.force && Date.now() - cache.fetchedAt < MAX_AGE_MS) {
    return cache.promise;
  }
  const promise = client
    .get<unknown>("agent-memory/graph")
    .then((raw) => agentMemoryGraphResponseSchema.parse(raw));
  const entry = { promise, fetchedAt: Date.now() };
  cache = entry;
  promise.catch(() => {
    if (cache === entry) cache = null;
  });
  return promise;
}

/** Fire-and-forget warm-up for app load; failures stay silent. */
export function prefetchAgentMemoryGraph(client: AdminClient): void {
  fetchAgentMemoryGraph(client).catch(() => {});
}
