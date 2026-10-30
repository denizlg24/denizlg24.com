import { AsyncLocalStorage } from "node:async_hooks";
import { AGENT_ACTOR_HEADER, agentRunActorSchema } from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { WorkflowCausationModel } from "@/models/DomainEvent";

/*
 * Which triggers led to the code running now. A trigger's action list runs in
 * this process inside `withCausation`; an agent run a trigger started works
 * through MCP — other requests, carrying its actor header — so its chain is
 * stored under that actor and looked up from the header. The header is
 * attribution any service-token holder could claim; it is only ever used to
 * suppress (fire fewer triggers, form no memory), never to allow anything.
 */

export interface Causation {
  /** Outermost first; empty when an owner or an ordinary agent acted. */
  triggerIds: string[];
  depth: number;
}

export const NO_CAUSATION: Causation = { triggerIds: [], depth: 0 };

const store = new AsyncLocalStorage<Causation>();

export function withCausation<T>(
  causation: Causation,
  run: () => Promise<T>,
): Promise<T> {
  return store.run(causation, run);
}

async function requestActor(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const claimed = agentRunActorSchema.safeParse(
      (await headers()).get(AGENT_ACTOR_HEADER),
    );
    return claimed.success ? claimed.data : null;
  } catch {
    // Outside a request (a job, a test): nothing to read.
    return null;
  }
}

export async function currentCausation(): Promise<Causation> {
  const local = store.getStore();
  if (local) return local;
  const actor = await requestActor();
  if (!actor) return NO_CAUSATION;
  await connectDB();
  const stored = await WorkflowCausationModel.findById(actor).lean();
  return stored
    ? { triggerIds: stored.triggerIds, depth: stored.depth }
    : NO_CAUSATION;
}

/** Whether a trigger caused this work, so it is not the owner's own doing. */
export async function isWorkflowCaused(): Promise<boolean> {
  return (await currentCausation()).triggerIds.length > 0;
}

/** Remembers that the agent run acting as `actor` descends from `causation`. */
export async function recordAgentCausation(
  actor: string,
  causation: Causation,
): Promise<void> {
  await WorkflowCausationModel.updateOne(
    { _id: actor },
    {
      $set: {
        triggerIds: causation.triggerIds,
        depth: causation.depth,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  ).exec();
}
