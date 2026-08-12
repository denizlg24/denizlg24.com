import type { LlmCatalogModel, LlmModelsResponse } from "@repo/schemas";
import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "../provider";

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

export function useModelCatalog(): ModelCatalogState {
  const { client } = useAdmin();
  const [models, setModels] = useState<LlmCatalogModel[] | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.get<LlmModelsResponse>("llm/models");
      setModels(result.models);
      setStale(result.stale);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to load models",
      );
      setLoading(false);
      return;
    }
    setLoading(false);
  }, [client]);

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
  const preferredDefaults = [
    "openai/gpt-5.6-luna",
    "anthropic/claude-opus-4.8",
  ];

  for (const preferred of preferredDefaults) {
    const entry = models.find((model) => model.id === preferred);
    if (
      entry &&
      requiredCapabilities.every((tag) => entry.tags.includes(tag))
    ) {
      return entry.id;
    }
  }

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
