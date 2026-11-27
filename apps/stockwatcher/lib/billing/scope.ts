import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

export type MeteredStep = {
  providerMetadata?: Record<string, Record<string, unknown>> | undefined;
  usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
  };
};

/**
 * Model steps run below a request (tool calls, filing extraction) that the
 * request's settlement must include. Steps, not a summed cost, so a step the
 * gateway returned without an inline cost can still be priced by generation id.
 * `guard`, when the request carries a budget, throws `OutOfCreditsError` once
 * the request can no longer afford another model call.
 */
export type CostScope = {
  steps: MeteredStep[];
  guard?: (prompt: string) => Promise<void>;
};

export class OutOfCreditsError extends Error {
  readonly code = "out_of_credits";
  constructor(message = "Stopped: out of credits.") {
    super(message);
    this.name = "OutOfCreditsError";
  }
}

const storage = new AsyncLocalStorage<CostScope>();

export function withCostScope<T>(run: (scope: CostScope) => T): T {
  const scope: CostScope = { steps: [] };
  return storage.run(scope, () => run(scope));
}

/** Call from `onStepEnd`, so a step is counted even when its output later fails validation. */
export function addScopedStep(step: MeteredStep) {
  storage.getStore()?.steps.push(step);
}

/** Call before a model call made below a request; throws when its budget cannot cover it. */
export async function guardScopedSpend(prompt: string) {
  await storage.getStore()?.guard?.(prompt);
}
