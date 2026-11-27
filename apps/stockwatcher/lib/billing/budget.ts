import "server-only";
import { gateway } from "@/lib/ai/config";
import type { Identity } from "@/lib/db";
import {
  chargeFor,
  creditConfig,
  credits,
  extendHold,
  type Reservation,
} from "./credits";
import type { MeteredStep } from "./scope";

type Rates = { input: number; output: number };

const perMillion = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return (Number.isFinite(value) && value > 0 ? value : fallback) / 1e6;
};

const fallbackRates = (): Rates => ({
  input: perMillion("CHAT_ESTIMATE_USD_PER_MTOK_IN", 5),
  output: perMillion("CHAT_ESTIMATE_USD_PER_MTOK_OUT", 25),
});

const ratesCache = new Map<string, { rates: Rates; at: number }>();
const RATES_TTL_MS = 60 * 60_000;

/** Per-token USD list prices from the gateway, for steps it returned without a cost. */
export async function modelRates(modelId: string): Promise<Rates> {
  const cached = ratesCache.get(modelId);
  if (cached && Date.now() - cached.at < RATES_TTL_MS) return cached.rates;
  let rates = fallbackRates();
  try {
    const { models } = await gateway().getAvailableModels();
    const pricing = models.find((model) => model.id === modelId)?.pricing;
    const input = Number(pricing?.input);
    const output = Number(pricing?.output);
    if (Number.isFinite(input) && Number.isFinite(output))
      rates = { input, output };
  } catch {
    // Keep the fallback; the settlement still uses the gateway's real cost.
  }
  ratesCache.set(modelId, { rates, at: Date.now() });
  return rates;
}

/** Charge in millicredits: the gateway's inline cost, else a list-price estimate from tokens. */
export function stepCharge(step: MeteredStep, rates: Rates) {
  const cost = Number(step.providerMetadata?.gateway?.cost);
  if (Number.isFinite(cost)) return chargeFor(cost);
  const input = step.usage?.inputTokens ?? 0;
  const output = step.usage?.outputTokens ?? 0;
  return chargeFor(input * rates.input + output * rates.output);
}

/** Rough token count of a prompt, erring high (three characters a token). */
export const promptTokens = (prompt: unknown) =>
  Math.ceil(JSON.stringify(prompt ?? "").length / 3);

export function firstStepCharge(
  tokens: number,
  rates: Rates,
  outputTokens = 2_000,
) {
  return chargeFor(tokens * rates.input + outputTokens * rates.output);
}

/** Context only grows across a turn, so the next step costs at least the last one. */
const GROWTH = 1.2;

export type Budget = {
  /** Millicredits charged so far by these steps. */
  spent: (steps: ReadonlyArray<MeteredStep>) => number;
  /** Projected charge of the step after `last`, or of the first step. */
  projectNext: (last?: MeteredStep) => number;
  /**
   * Whether the account can pay `nextMc` more after `steps`, growing the hold
   * when it can. Once false it stays false.
   */
  affords: (
    steps: ReadonlyArray<MeteredStep>,
    nextMc: number,
  ) => Promise<boolean>;
  readonly exhausted: boolean;
};

export function createBudget(
  user: Pick<Identity, "id" | "demo">,
  reservation: Extract<Reservation, { ok: true }>,
  rates: Rates,
  firstStepMc: number,
): Budget {
  const spent = (steps: ReadonlyArray<MeteredStep>) =>
    steps.reduce((sum, step) => sum + stepCharge(step, rates), 0);
  const projectNext = (last?: MeteredStep) =>
    last ? Math.ceil(stepCharge(last, rates) * GROWTH) : firstStepMc;
  const { holdId } = reservation;
  if (!reservation.metered || !holdId)
    return { spent, projectNext, affords: async () => true, exhausted: false };

  let holdMc = reservation.amountMc;
  let exhausted = false;
  let queue: Promise<unknown> = Promise.resolve();

  const check = async (steps: ReadonlyArray<MeteredStep>, nextMc: number) => {
    if (exhausted) return false;
    const need = spent(steps) + nextMc;
    if (need <= holdMc) return true;
    // Grow with headroom so most steps do not need a round trip.
    holdMc = await extendHold(user.id, holdId, need + creditConfig().reserve);
    if (holdMc >= need) return true;
    exhausted = true;
    console.info("Stockwatcher stopped a turn at its credit budget", {
      spent: credits(need - nextMc),
      next: credits(nextMc),
      held: credits(holdMc),
    });
    return false;
  };

  return {
    spent,
    projectNext,
    get exhausted() {
      return exhausted;
    },
    // Scoped guards can run in parallel within a step; serialise hold updates.
    affords: (steps, nextMc) => {
      const run = queue.then(() => check(steps, nextMc));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
