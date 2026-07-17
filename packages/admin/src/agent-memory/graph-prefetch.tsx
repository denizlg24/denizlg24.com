import type { AgentMemoryGraphResponse } from "@repo/schemas";
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
  // Overlap the three.js/react-force-graph-3d chunk download with the data
  // fetch — next/dynamic would otherwise only start it on first render.
  void import("react-force-graph-3d").catch(() => {});
  if (cache && !options.force && Date.now() - cache.fetchedAt < MAX_AGE_MS) {
    return cache.promise;
  }
  // The route validates against agentMemoryGraphResponseSchema before
  // responding, so the payload is trusted as-is — re-parsing a large graph
  // with zod here costs real main-thread time.
  const promise = client.get<AgentMemoryGraphResponse>("agent-memory/graph");
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
