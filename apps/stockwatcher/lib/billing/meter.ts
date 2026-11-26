import "server-only";
import { gateway } from "@/lib/ai/config";
import type { Identity } from "@/lib/db";
import {
  gatewayCost,
  type Reservation,
  release,
  settle,
  type Usage,
} from "./credits";
import type { MeteredStep } from "./scope";

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function lookupCost(generationId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const info = await gateway().getGenerationInfo({ id: generationId });
      if (Number.isFinite(info.totalCost)) return info.totalCost;
    } catch {
      // Ingestion lags the response by a few seconds.
    }
    await sleep(1500 * (attempt + 1));
  }
  return null;
}

/**
 * USD cost of the steps: the cost the gateway attached, else a lookup by
 * generation id. `unresolved` counts steps neither could price, and
 * `unresolvedIds` keeps their generation ids so they can be priced later.
 */
export async function stepsCost(steps: ReadonlyArray<MeteredStep>) {
  const direct = gatewayCost(steps);
  if (!direct.missing)
    return { costUsd: direct.costUsd, unresolved: 0, unresolvedIds: [] };
  let costUsd = direct.costUsd;
  let unresolved = 0;
  const unresolvedIds: string[] = [];
  for (const step of steps) {
    const meta = step.providerMetadata?.gateway;
    if (Number.isFinite(Number(meta?.cost))) continue;
    const id = meta?.generationId;
    const cost = typeof id === "string" ? await lookupCost(id) : null;
    if (cost !== null) {
      costUsd += cost;
      continue;
    }
    unresolved++;
    if (typeof id === "string") unresolvedIds.push(id);
  }
  return { costUsd, unresolved, unresolvedIds };
}

/**
 * Settles a reservation for finished steps; never throws into the caller's
 * stream. Unpriced steps are recorded on the ledger entry (`meta.unresolved`)
 * rather than retried: durable retry belongs to the worker queue (plan 035,
 * phase 2).
 */
export async function meter(
  user: Pick<Identity, "id" | "demo">,
  reservation: Extract<Reservation, { ok: true }>,
  steps: ReadonlyArray<MeteredStep>,
  usage: Omit<Usage, "costUsd" | "unresolved" | "unresolvedIds">,
): Promise<number | null> {
  try {
    if (!steps.length) {
      await release(reservation);
      return 0;
    }
    const { costUsd, unresolved, unresolvedIds } = await stepsCost(steps);
    if (unresolved)
      console.error("Stockwatcher could not price model steps", {
        ref: usage.ref,
        unresolved,
      });
    return await settle(user, reservation, {
      ...usage,
      costUsd,
      unresolved,
      unresolvedIds,
    });
  } catch (error) {
    console.error("Stockwatcher credit settlement failed", {
      ref: usage.ref,
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}
