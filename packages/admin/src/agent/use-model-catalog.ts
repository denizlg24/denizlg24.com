import type { LlmCatalogModel, LlmModelsResponse } from "@repo/schemas";
import { useCallback, useEffect, useRef, useState } from "react";

export { pickDefaultModel } from "@repo/utils";

import { useAdmin } from "../provider";
import { AI_PROVIDER_CHANGED, getAgentModelCatalog } from "./provider-models";

// Agent selectors follow the selected connection, including changes made
// while the desktop dock stays mounted beside Settings.

export interface ModelCatalogState {
  models: LlmCatalogModel[] | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useModelCatalog(
  source: "agent" | "gateway" = "agent",
): ModelCatalogState {
  const { client } = useAdmin();
  const [models, setModels] = useState<LlmCatalogModel[] | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result =
        source === "agent"
          ? await getAgentModelCatalog(client)
          : await client.get<LlmModelsResponse>("llm/models");
      if (request !== generation.current) return;
      setModels(result.models);
      setStale(result.stale);
    } catch (error) {
      if (request !== generation.current) return;
      setModels(null);
      setError(
        error instanceof Error ? error.message : "Failed to load models",
      );
      setLoading(false);
      return;
    }
    setLoading(false);
  }, [client, source]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener(AI_PROVIDER_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      generation.current++;
      window.removeEventListener(AI_PROVIDER_CHANGED, refresh);
      window.removeEventListener("focus", refresh);
    };
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
