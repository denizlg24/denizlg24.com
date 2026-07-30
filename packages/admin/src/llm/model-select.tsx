"use client";

import type { LlmCatalogModel } from "@repo/schemas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "../provider";

/**
 * Catalog entries are the full Gateway records so hosts that ship a rich picker
 * (creator/capability filters, pricing) get everything they need; `ModelSelect`
 * only ever reads `id` and `name`.
 */
export type CatalogModel = LlmCatalogModel;

const DEFAULT_SENTINEL = "__default__";

export function useModelCatalog(requiredCapability?: string) {
  const { client } = useAdmin();
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const query = requiredCapability
      ? `llm/models?requiredCapability=${encodeURIComponent(requiredCapability)}`
      : "llm/models";
    setModelsLoading(true);
    (async () => {
      try {
        const raw = await client.get<{
          models?: CatalogModel[];
          stale?: boolean;
        }>(query);
        if (cancelled) return;
        setModels(raw.models ?? []);
        setStale(raw.stale === true);
        setModelsError(null);
      } catch (error) {
        // Catalog cold or unreachable — the stored value still renders.
        if (!cancelled) {
          setModelsError(
            error instanceof Error ? error.message : "Catalog unavailable",
          );
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, requiredCapability, reloadToken]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  return { models, modelsLoading, modelsError, stale, retry };
}

/**
 * Picks a Gateway model id, with `null` meaning "fall back to the server
 * default". A stored id that is missing from the catalog stays selectable so a
 * cold or filtered catalog cannot silently reset the setting.
 */
export function ModelSelect({
  value,
  onChange,
  models,
  defaultLabel,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  models: CatalogModel[];
  defaultLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const known = value !== null && models.some((model) => model.id === value);

  return (
    <Select
      value={value ?? DEFAULT_SENTINEL}
      disabled={disabled}
      onValueChange={(next) =>
        onChange(next === DEFAULT_SENTINEL ? null : next)
      }
    >
      <SelectTrigger className={className ?? "h-8 w-full max-w-md text-xs"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_SENTINEL} className="text-xs">
          {defaultLabel}
        </SelectItem>
        {value !== null && !known && (
          <SelectItem value={value} className="text-xs">
            {value} (current)
          </SelectItem>
        )}
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id} className="text-xs">
            {model.name} · {model.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Same picker for settings whose model id is required — no "server default"
 * entry. A stored id missing from the catalog stays selectable for the same
 * reason as in `ModelSelect`.
 */
export function RequiredModelSelect({
  value,
  onChange,
  models,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  models: CatalogModel[];
  disabled?: boolean;
  className?: string;
}) {
  const known = models.some((model) => model.id === value);

  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger className={className ?? "h-8 w-full max-w-md text-xs"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {value && !known && (
          <SelectItem value={value} className="text-xs">
            {value} (current)
          </SelectItem>
        )}
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id} className="text-xs">
            {model.name} · {model.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
