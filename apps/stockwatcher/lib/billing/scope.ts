import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { gatewayCost } from "./credits";

/** Model spend made below a request (tool calls, filing extraction) that the request's settlement must include. */
export type CostScope = { extraUsd: number };

const storage = new AsyncLocalStorage<CostScope>();

export function withCostScope<T>(run: (scope: CostScope) => T): T {
  const scope: CostScope = { extraUsd: 0 };
  return storage.run(scope, () => run(scope));
}

export function addScopedCost(
  steps: ReadonlyArray<{
    providerMetadata?: Record<string, Record<string, unknown>> | undefined;
  }>,
) {
  const scope = storage.getStore();
  if (scope) scope.extraUsd += gatewayCost(steps).costUsd;
}
