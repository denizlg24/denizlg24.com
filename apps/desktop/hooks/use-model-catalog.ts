import { useCallback, useEffect, useState } from "react";
import type { denizApi } from "@/lib/api-wrapper";
import type { LlmCatalogModel, LlmModelsResponse } from "@/lib/data-types";

// Fetches the Gateway model catalog through the authenticated web API. There
// is deliberately no hardcoded fallback list: when discovery fails the UI
// shows a retry state and keeps the currently selected id for display.

export interface ModelCatalogState {
  models: LlmCatalogModel[] | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useModelCatalog(API: denizApi | null): ModelCatalogState {
  const [models, setModels] = useState<LlmCatalogModel[] | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!API) return;
    setLoading(true);
    setError(null);
    const result = await API.GET<LlmModelsResponse>({
      endpoint: "llm/models",
    });
    if ("code" in result) {
      setError(result.message ?? "Failed to load models");
      setLoading(false);
      return;
    }
    setModels(result.models);
    setStale(result.stale);
    setLoading(false);
  }, [API]);

  useEffect(() => {
    load();
  }, [load]);

  return { models, stale, loading, error, retry: load };
}

/**
 * True when the model may be used with the required capabilities. Unknown
 * models (no catalog, or an id the catalog no longer lists) pass — the server
 * rejects incompatible models authoritatively before generation.
 */
export function isModelEligible(
  modelId: string,
  models: LlmCatalogModel[] | null,
  requiredCapabilities: string[],
): boolean {
  const entry = models?.find((model) => model.id === modelId);
  if (!entry) return true;
  return requiredCapabilities.every((tag) => entry.tags.includes(tag));
}

/** Resolves a display label from the catalog, falling back to the raw id. */
export function modelDisplayName(
  modelId: string,
  models: LlmCatalogModel[] | null,
): string {
  return models?.find((model) => model.id === modelId)?.name ?? modelId;
}

/**
 * Default pick for a fresh chat: the cheapest eligible Anthropic-created
 * model (any eligible model when none). Heuristic, not a hardcoded id.
 */
export function pickDefaultModel(
  models: LlmCatalogModel[],
  requiredCapabilities: string[],
): string | null {
  const eligible = models.filter((model) =>
    requiredCapabilities.every((tag) => model.tags.includes(tag)),
  );
  const pool = eligible.some((model) => model.creator === "anthropic")
    ? eligible.filter((model) => model.creator === "anthropic")
    : eligible;
  const cheapest = [...pool].sort(
    (left, right) =>
      (left.pricing?.input ?? Number.POSITIVE_INFINITY) -
      (right.pricing?.input ?? Number.POSITIVE_INFINITY),
  )[0];
  return cheapest?.id ?? null;
}
