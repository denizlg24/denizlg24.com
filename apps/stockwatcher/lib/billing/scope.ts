import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

export type MeteredStep = {
  providerMetadata?: Record<string, Record<string, unknown>> | undefined;
};

/**
 * Model steps run below a request (tool calls, filing extraction) that the
 * request's settlement must include. Steps, not a summed cost, so a step the
 * gateway returned without an inline cost can still be priced by generation id.
 */
export type CostScope = { steps: MeteredStep[] };

const storage = new AsyncLocalStorage<CostScope>();

export function withCostScope<T>(run: (scope: CostScope) => T): T {
  const scope: CostScope = { steps: [] };
  return storage.run(scope, () => run(scope));
}

/** Call from `onStepEnd`, so a step is counted even when its output later fails validation. */
export function addScopedStep(step: MeteredStep) {
  storage.getStore()?.steps.push(step);
}
