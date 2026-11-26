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

type MeteredStep = {
  providerMetadata?: Record<string, Record<string, unknown>> | undefined;
};

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

/** USD cost of the steps: the cost the gateway attached, else a lookup by generation id. */
export async function stepsCost(steps: ReadonlyArray<MeteredStep>) {
  const direct = gatewayCost(steps);
  if (!direct.missing) return direct.costUsd;
  let total = direct.costUsd;
  for (const step of steps) {
    const gatewayMeta = step.providerMetadata?.gateway;
    if (Number.isFinite(Number(gatewayMeta?.cost))) continue;
    const id = gatewayMeta?.generationId;
    if (typeof id !== "string") continue;
    const cost = await lookupCost(id);
    if (cost !== null) total += cost;
  }
  return total;
}

/** Settles a reservation for finished steps; never throws into the caller's stream. */
export async function meter(
  user: Pick<Identity, "id" | "demo">,
  reservation: Extract<Reservation, { ok: true }>,
  steps: ReadonlyArray<MeteredStep>,
  usage: Omit<Usage, "costUsd">,
  extraUsd = 0,
): Promise<number | null> {
  try {
    const costUsd = (steps.length ? await stepsCost(steps) : 0) + extraUsd;
    if (!costUsd && !steps.length) {
      await release(reservation);
      return 0;
    }
    return await settle(user, reservation, { ...usage, costUsd });
  } catch (error) {
    console.error("Stockwatcher credit settlement failed", {
      ref: usage.ref,
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}
